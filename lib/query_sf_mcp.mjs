#!/usr/bin/env node
/**
 * Queries Salesforce via the MCP HTTP server using Node.js fetch (SSE-safe).
 * Replaces query_sf_mcp.py which hung on chunked SSE streams via urllib.
 *
 * Required env:  SF_MCP_TOKEN
 * Usage:
 *   node lib/query_sf_mcp.mjs data/sf_latest.json
 *   node lib/query_sf_mcp.mjs data/sf_activities_latest.json --soql-key activities_soql
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

// ── args ─────────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const outFile  = args[0] || 'data/sf_latest.json';
const soqlKey  = (() => {
  const i = args.indexOf('--soql-key');
  return i !== -1 ? args[i + 1] : 'soql';
})();

// ── config ───────────────────────────────────────────────────────────────────
const config       = JSON.parse(readFileSync('config.json', 'utf8'));
const soqlTemplate = config[soqlKey];
const backMonths   = parseInt(config.date_window_back_months ?? 1);
const fwdMonths    = parseInt(config.date_window_forward_months ?? 6);

// ── date window ───────────────────────────────────────────────────────────────
function clampDay(y, m, d) {
  return new Date(y, m, 0).getDate(); // days in month (month is 1-based here)
}
const today = new Date();
const [ty, tm, td] = [today.getFullYear(), today.getMonth() + 1, today.getDate()];

let fm = tm - backMonths, fy = ty;
while (fm <= 0) { fm += 12; fy -= 1; }
const dateFrom = `${fy}-${String(fm).padStart(2,'0')}-${String(Math.min(td, clampDay(fy, fm, td))).padStart(2,'0')}`;

let tm2 = tm + fwdMonths, ty2 = ty;
while (tm2 > 12) { tm2 -= 12; ty2 += 1; }
const dateTo = `${ty2}-${String(tm2).padStart(2,'0')}-${String(Math.min(td, clampDay(ty2, tm2, td))).padStart(2,'0')}`;

const soql = soqlTemplate.replace(/{date_from}/g, dateFrom).replace(/{date_to}/g, dateTo);
if (soqlKey === 'soql') process.stderr.write(`  → Date range: ${dateFrom} → ${dateTo}\n`);
process.stderr.write(`  → SOQL key: ${soqlKey}\n`);

// ── MCP SSE client ────────────────────────────────────────────────────────────
const TOKEN   = process.env.SF_MCP_TOKEN;
const MCP_URL = `https://mcp.csaiautomations.com/salesforce/mcp/?token=${TOKEN}`;

async function mcpPost(body, sessionId) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  process.stderr.write('  → fetch start\n');
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  process.stderr.write(`  → fetch done: ${res.status}\n`);

  const sid = res.headers.get('mcp-session-id');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    process.stderr.write('  → reader.read...\n');
    const { done, value } = await reader.read();
    const chunk = decoder.decode(value, { stream: true });
    process.stderr.write(`  → read done:${done} bytes:${value?.length} chunk:${JSON.stringify(chunk)}\n`);
    if (done) break;
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop(); // keep incomplete last line
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed.startsWith('data: ')) {
        const msg = JSON.parse(trimmed.slice(6));
        reader.cancel();
        if ('result' in msg) return { result: msg.result, sid };
        if ('error'  in msg) throw new Error(`MCP error: ${JSON.stringify(msg.error)}`);
      }
    }
  }
  throw new Error('No result in MCP response');
}

async function mcpInit() {
  const { sid } = await mcpPost({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'trilogy-dashboard', version: '1.0' } },
  });
  return sid;
}

async function sfQuery(soql, sessionId, reqId) {
  const { result } = await mcpPost({
    jsonrpc: '2.0', id: reqId, method: 'tools/call',
    params: { name: 'sf_query', arguments: { soql, tenantId: 'trilogy' } },
  }, sessionId);

  const rawText = result?.content?.[0]?.text ?? '{}';
  try {
    const outer     = JSON.parse(rawText);
    const innerText = outer?.content?.[0]?.text ?? '{}';
    return JSON.parse(innerText);
  } catch {
    return JSON.parse(rawText);
  }
}

// ── paginated query ───────────────────────────────────────────────────────────
const PAGE = 200;
const allRecords = [];
let offset = 0;

process.stderr.write('  → calling mcpInit\n');
const sessionId = await mcpInit();
process.stderr.write(`  → session: ${sessionId}\n`);

while (true) {
  const paged = `${soql} LIMIT ${PAGE} OFFSET ${offset}`;
  const data  = await sfQuery(paged, sessionId, offset / PAGE + 2);
  const recs  = data.records ?? [];

  for (const rec of recs) {
    delete rec.attributes;
    for (const v of Object.values(rec)) {
      if (v && typeof v === 'object') delete v.attributes;
    }
  }

  allRecords.push(...recs);
  process.stderr.write(`  → Page ${offset / PAGE + 1}: ${recs.length} records  (total: ${allRecords.length})\n`);

  if (recs.length < PAGE) break;
  offset += PAGE;
}

// ── write output ──────────────────────────────────────────────────────────────
mkdirSync(dirname(resolve(outFile)), { recursive: true });
writeFileSync(outFile, JSON.stringify(allRecords));
process.stderr.write(`  → Saved ${allRecords.length} records to ${outFile}\n`);
