#!/usr/bin/env python3
"""
Salesforce Renewal Pipeline Dashboard Generator
================================================
Takes a raw Salesforce opportunities JSON export and produces a self-contained
interactive HTML dashboard — no server required.

Usage:
    python3 build_pipeline_dashboard.py <input.json> <output.html>

The input JSON can be:
  - A raw array:   [{"Id": "...", "Name": "...", ...}, ...]
  - A SF result:   {"records": [...], "totalSize": N, "done": true}

Dashboard includes:
  - 4 KPI cards: Total ARR, Likely to Win, Likely to Churn, At-Risk ARR
  - Outcome donut chart (Win / Churn / Undetermined by ARR)
  - Stage horizontal bar chart (by ARR)
  - Product horizontal bar chart (top 12 by ARR)
  - Owner stacked bar chart (Win / Churn / Undetermined counts)
  - Sortable, filterable opportunities table (max 200 visible rows)
  - Live filters: Stage, Owner, Product, Outcome
"""

import json
import sys
import os
from collections import defaultdict
from datetime import datetime

# ── Field mapping ─────────────────────────────────────────────────────────────
# These match the confirmed Salesforce API field names for this org.
FIELD_MAP = {
    "id":           "Id",
    "name":         "Name",
    "owner":        ("Owner", "Name"),      # nested
    "account":      ("Account", "Name"),    # nested
    "stage":        "StageName",
    "status":       "Opportunity_Status__c",
    "outcome":      "Probable_Outcome__c",
    "arr":          "ARR__c",
    "current_arr":  "Current_ARR__c",
    "arr_increase": "ARR_Increase__c",
    "renewal_date": "Renewal_Date__c",
    "close_date":   "CloseDate",
    "last_activity":"LastActivityDate",
    "next_followup":"Next_Follow_Up_Date__c",
    "product":      "Product__c",
    "success_level":"Success_Level__c",
    "churn_risks":  "Churn_Risks__c",
    "auto_renewed": "Auto_Renewed_Last_Term__c",
}

def get_field(record, spec):
    """Extract a field, handling nested dicts like Owner.Name."""
    if isinstance(spec, tuple):
        parent, child = spec
        nested = record.get(parent)
        if isinstance(nested, dict):
            return nested.get(child) or ""
        return ""
    return record.get(spec)

def get_account_id(record):
    """Extract Account Id from direct field or attributes URL."""
    account = record.get('Account')
    if not isinstance(account, dict):
        return ''
    if account.get('Id'):
        return account['Id']
    url = account.get('attributes', {}).get('url', '')
    return url.rstrip('/').split('/')[-1] if url else ''

def clean_records(raw):
    """Normalize raw Salesforce records into flat dicts for the dashboard."""
    records = []
    for r in raw:
        rec = {}
        for key, spec in FIELD_MAP.items():
            val = get_field(r, spec)
            if val is None:
                val = "" if key not in ("arr", "current_arr", "arr_increase") else 0
            if key in ("arr", "current_arr", "arr_increase"):
                try:
                    val = float(val) if val else 0.0
                except (TypeError, ValueError):
                    val = 0.0
            rec[key] = val
        rec['account_id'] = get_account_id(r)
        # Normalise nullish status/outcome
        if not rec["status"]:
            rec["status"] = "Unknown"
        if not rec["outcome"]:
            rec["outcome"] = "Undetermined"
        if rec.get("stage") == "Won't Process":
            continue
        records.append(rec)
    return records

def aggregate(records):
    """Pre-aggregate data for charts."""
    stage   = defaultdict(lambda: {"count": 0, "arr": 0.0})
    outcome = defaultdict(lambda: {"count": 0, "arr": 0.0})
    product = defaultdict(lambda: {"count": 0, "arr": 0.0})
    owner   = defaultdict(lambda: {"count": 0, "arr": 0.0, "win": 0, "churn": 0})
    status  = defaultdict(lambda: {"count": 0, "arr": 0.0})
    month   = defaultdict(lambda: {"count": 0, "arr": 0.0, "win": 0.0, "churn": 0.0})

    for r in records:
        for d, key in [(stage, r["stage"]), (outcome, r["outcome"]), (product, r["product"] or "Unknown"), (status, r["status"])]:
            d[key]["count"] += 1
            d[key]["arr"]   += r["arr"]
        o = owner[r["owner"] or "Unknown"]
        o["count"] += 1
        o["arr"]   += r["arr"]
        if r["outcome"] == "Likely to Win":   o["win"]   += 1
        if r["outcome"] == "Likely to Churn": o["churn"] += 1
        # Renewal month bucketing
        rd = r.get("renewal_date", "")
        if rd and len(rd) >= 7:
            ym = rd[:7]   # YYYY-MM
            month[ym]["count"] += 1
            month[ym]["arr"]   += r["arr"]
            if r["outcome"] == "Likely to Win":   month[ym]["win"]   += r["arr"]
            if r["outcome"] == "Likely to Churn": month[ym]["churn"] += r["arr"]

    total_arr   = sum(r["arr"] for r in records)
    win_arr     = sum(r["arr"] for r in records if r["outcome"] == "Likely to Win")
    churn_arr   = sum(r["arr"] for r in records if r["outcome"] == "Likely to Churn")
    risk_arr    = sum(r["arr"] for r in records if r["status"] in ("Warning", "Attention Required"))
    win_count   = sum(1 for r in records if r["outcome"] == "Likely to Win")
    churn_count = sum(1 for r in records if r["outcome"] == "Likely to Churn")
    risk_count  = sum(1 for r in records if r["status"] in ("Warning", "Attention Required"))

    top_products = sorted(product.items(), key=lambda x: -x[1]["arr"])[:12]
    top_owners   = [
        {"label": k, **v}
        for k, v in sorted(owner.items(), key=lambda x: -x[1]["arr"])
        if k not in ("Sales Integration", "Unknown", "")
    ]

    # Month labels: Jan 26, Feb 26, etc.
    MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    month_chart = []
    for ym, v in sorted(month.items()):
        try:
            y, m = int(ym[:4]), int(ym[5:7])
            label = f"{MONTH_NAMES[m-1]} '{str(y)[2:]}"
        except Exception:
            label = ym
        month_chart.append({"label": label, "ym": ym, **v})

    status_order = ["On Track", "Warning", "Attention Required", "Unknown"]
    status_chart = [{"label": k, **status[k]} for k in status_order if k in status]
    # append any statuses not in the fixed order
    seen = set(status_order)
    for k, v in sorted(status.items(), key=lambda x: -x[1]["arr"]):
        if k not in seen:
            status_chart.append({"label": k, **v})

    return {
        "kpis": {
            "total_arr": total_arr, "total_count": len(records),
            "win_arr": win_arr, "win_count": win_count,
            "churn_arr": churn_arr, "churn_count": churn_count,
            "risk_arr": risk_arr, "risk_count": risk_count,
        },
        "stage_chart":   [{"label": k, **v} for k, v in sorted(stage.items(), key=lambda x: -x[1]["arr"])],
        "outcome_chart": [{"label": k, **v} for k, v in outcome.items()],
        "product_chart": [{"label": k, **v} for k, v in top_products],
        "owner_chart":   top_owners,
        "month_chart":   month_chart,
        "status_chart":  status_chart,
    }

def build_html(records, agg, export_date="", refresh_url="/refresh"):
    records_json = json.dumps(records)
    stage_json   = json.dumps(agg["stage_chart"])
    outcome_json = json.dumps(agg["outcome_chart"])
    product_json = json.dumps(agg["product_chart"])
    owner_json   = json.dumps(agg["owner_chart"])
    month_json   = json.dumps(agg["month_chart"])
    status_json  = json.dumps(agg["status_chart"])
    n            = len(records)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Salesforce Renewal Pipeline — {export_date}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js"></script>
<style>
:root {{
  --bg:#f0f4f8; --card:#fff; --header:#0f1c2e; --accent:#2563eb;
  --win:#16a34a; --churn:#dc2626; --warn:#d97706;
  --text:#1e293b; --muted:#64748b; --border:#e2e8f0; --gap:16px; --r:10px;
}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);font-size:14px}}
.wrap{{max-width:1440px;margin:0 auto;padding:var(--gap)}}
header{{background:var(--header);color:#fff;padding:14px 24px;border-radius:var(--r);margin-bottom:var(--gap);display:flex;justify-content:space-between;align-items:center;flex-wrap:nowrap;gap:16px}}
header h1{{font-size:16px;font-weight:700;display:flex;align-items:center;gap:10px;white-space:nowrap;flex-shrink:0}}
.sf-badge{{background:#00a1e0;border-radius:6px;padding:3px 9px;font-size:12px;font-weight:600;letter-spacing:.5px}}
.filters{{display:flex;gap:8px;flex-wrap:nowrap;align-items:center}}
.filters label{{font-size:11px;color:rgba(255,255,255,.6);margin-right:2px;white-space:nowrap}}
.filters select{{padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff;font-size:12px;cursor:pointer}}
.filters select option{{background:#1e293b}}
.reset-btn{{padding:5px 12px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:transparent;color:#fff;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0}}
.reset-btn:hover{{background:rgba(255,255,255,.1)}}
.refresh-btn{{padding:5px 14px;border-radius:6px;border:none;background:#2563eb;color:#fff;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s;white-space:nowrap;flex-shrink:0}}
.refresh-btn:hover{{background:#1d4ed8}}.refresh-btn:disabled{{background:#475569;cursor:default;}}
.refresh-status{{font-size:11px;color:rgba(255,255,255,.65);white-space:nowrap;}}
.kpi-row{{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--gap);margin-bottom:var(--gap)}}
.kpi{{background:var(--card);border-radius:var(--r);padding:20px 22px;box-shadow:0 1px 4px rgba(0,0,0,.07);border-left:4px solid transparent;cursor:pointer;transition:transform .12s,box-shadow .15s;}}
.kpi:hover{{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.12);}}
.kpi.active{{box-shadow:0 0 0 2px var(--accent),0 4px 12px rgba(0,0,0,.1);}}
.kpi.blue{{border-left-color:var(--accent)}}.kpi.green{{border-left-color:var(--win)}}.kpi.red{{border-left-color:var(--churn)}}.kpi.warn{{border-left-color:var(--warn)}}
.kpi-label{{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px}}
.kpi-value{{font-size:26px;font-weight:800;margin-bottom:2px}}.kpi-sub{{font-size:12px;color:var(--muted)}}
.chart-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--gap);margin-bottom:var(--gap)}}
.chart-box{{background:var(--card);border-radius:var(--r);padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.07);transition:box-shadow .15s;}}
.chart-box:hover{{box-shadow:0 4px 14px rgba(0,0,0,.1);}}
.chart-box h3{{font-size:12px;font-weight:600;margin-bottom:10px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none}}
.chart-box h3:hover{{color:var(--accent)}}
.chart-box h3 .expand-icon{{font-size:10px;color:var(--muted);margin-left:6px;transition:transform .2s}}
.chart-box canvas{{max-height:200px;cursor:pointer;transition:max-height .25s ease;}}
.chart-box.expanded canvas{{max-height:260px;}}
.chart-box.expanded h3 .expand-icon{{transform:rotate(180deg)}}
@media(max-width:1100px){{.chart-grid{{grid-template-columns:repeat(2,1fr)}}}}
.active-tag{{display:none;align-items:center;gap:6px;background:rgba(37,99,235,.18);border:1px solid rgba(37,99,235,.4);border-radius:6px;padding:3px 10px;font-size:11px;color:#fff;}}
.active-tag.show{{display:flex;}}
.active-tag button{{background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:13px;line-height:1;padding:0 2px;}}
.active-tag button:hover{{color:#fff;}}
.table-box{{background:var(--card);border-radius:var(--r);padding:20px 22px;box-shadow:0 1px 4px rgba(0,0,0,.07);margin-bottom:var(--gap);overflow-x:auto}}
.table-box-header{{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px}}
.table-box-header h3{{font-size:13px;font-weight:600}}.table-meta{{font-size:12px;color:var(--muted)}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
th{{text-align:left;padding:9px 14px;border-bottom:2px solid var(--border);color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;cursor:pointer;white-space:nowrap;user-select:none;transition:color .12s,background .12s}}
th:hover{{color:var(--text);background:#f8fafc}}
th.sort-active{{color:var(--text);background:#f1f5f9}}
th .sort-icon{{display:inline-block;margin-left:5px;opacity:.35;font-style:normal;font-size:10px}}
th.sort-active .sort-icon{{opacity:1;color:#2563eb}}
td{{padding:10px 14px;border-bottom:1px solid #f1f5f9;white-space:nowrap;vertical-align:middle}}
tr:hover td{{background:#f8fafc}}tr:last-child td{{border-bottom:none}}
.td-opp{{max-width:320px;overflow:hidden;text-overflow:ellipsis;}}
.td-acct{{max-width:220px;overflow:hidden;text-overflow:ellipsis;}}
a.sf-link{{color:#2563eb;text-decoration:none;font-weight:500}}
a.sf-link:hover{{text-decoration:underline;color:#1d4ed8}}
.badge{{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}}
.b-win{{background:#dcfce7;color:#15803d}}.b-churn{{background:#fee2e2;color:#b91c1c}}.b-undet{{background:#f1f5f9;color:#475569}}
.b-warn{{background:#fef3c7;color:#92400e}}.b-attn{{background:#ffedd5;color:#9a3412}}.b-track{{background:#dcfce7;color:#15803d}}
.b-stage{{background:#eff6ff;color:#1d4ed8}}
footer{{text-align:center;color:var(--muted);font-size:11px;padding:10px 0 20px}}
@media(max-width:900px){{.chart-row{{grid-template-columns:1fr}}}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1><span class="sf-badge">SF</span> Renewal Pipeline Dashboard &nbsp;·&nbsp; {export_date}</h1>
  <div class="filters">
    <div><label>Stage</label>   <select id="f-stage"   onchange="applyFilters()"><option value="">All Stages</option></select></div>
    <div><label>Owner</label>   <select id="f-owner"   onchange="applyFilters()"><option value="">All Owners</option></select></div>
    <div><label>Product</label> <select id="f-product" onchange="applyFilters()"><option value="">All Products</option></select></div>
    <div><label>Outcome</label> <select id="f-outcome" onchange="applyFilters()"><option value="">All Outcomes</option></select></div>
    <div><label>Status</label>  <select id="f-status"  onchange="applyFilters()"><option value="">All Statuses</option></select></div>
    <div class="active-tag" id="active-tag"><span id="active-tag-label"></span><button onclick="resetFilters()">✕</button></div>
    <button class="reset-btn" onclick="resetFilters()">Reset</button>
    <span class="refresh-status" id="refresh-status"></span>
    <button class="refresh-btn" id="refresh-btn" onclick="doRefresh()">⟳ Refresh</button>
  </div>
</header>
<div class="kpi-row">
  <div class="kpi blue"  id="kpi-all"   onclick="kpiClick('all')">   <div class="kpi-label">Total Pipeline ARR</div><div class="kpi-value" id="k-arr"></div>      <div class="kpi-sub" id="k-count"></div></div>
  <div class="kpi green" id="kpi-win"   onclick="kpiClick('win')">   <div class="kpi-label">Likely to Win</div>     <div class="kpi-value" id="k-win-arr"></div>  <div class="kpi-sub" id="k-win-count"></div></div>
  <div class="kpi red"   id="kpi-churn" onclick="kpiClick('churn')"> <div class="kpi-label">Likely to Churn</div>   <div class="kpi-value" id="k-churn-arr"></div><div class="kpi-sub" id="k-churn-count"></div></div>
  <div class="kpi warn"  id="kpi-risk"  onclick="kpiClick('risk')">  <div class="kpi-label">At Risk (Warn+Attn)</div><div class="kpi-value" id="k-risk-arr"></div><div class="kpi-sub" id="k-risk-count"></div></div>
</div>
<div class="chart-grid">
  <div class="chart-box"><h3 onclick="toggleChart(this)">Probable Outcome — ARR Split<i class="expand-icon">▼</i></h3><canvas id="ch-outcome"></canvas></div>
  <div class="chart-box"><h3 onclick="toggleChart(this)">Pipeline by Stage — ARR<i class="expand-icon">▼</i></h3><canvas id="ch-stage"></canvas></div>
  <div class="chart-box"><h3 onclick="toggleChart(this)">ARR by Product (Top 12)<i class="expand-icon">▼</i></h3><canvas id="ch-product"></canvas></div>
  <div class="chart-box"><h3 onclick="toggleChart(this)">Owner Performance — Outcome Breakdown<i class="expand-icon">▼</i></h3><canvas id="ch-owner"></canvas></div>
  <div class="chart-box"><h3 onclick="toggleChart(this)">Renewals by Month — ARR<i class="expand-icon">▼</i></h3><canvas id="ch-month"></canvas></div>
  <div class="chart-box"><h3 onclick="toggleChart(this)">Pipeline by Status — ARR<i class="expand-icon">▼</i></h3><canvas id="ch-status"></canvas></div>
</div>
<div class="table-box" id="tbl-box">
  <div class="table-box-header"><h3 id="tbl-title">All Opportunities</h3><span class="table-meta" id="tbl-meta"></span></div>
  <div id="tbl-wrap"></div>
</div>
<footer>Data exported from Salesforce · {export_date} · {n} opportunities</footer>
</div>
<script>
const RAW={records_json};
const STAGE_AGG={stage_json};
const OUTCOME_AGG={outcome_json};
const PRODUCT_AGG={product_json};
const OWNER_AGG={owner_json};
const MONTH_AGG={month_json};
const STATUS_AGG={status_json};
const PALETTE=['#2563eb','#16a34a','#dc2626','#d97706','#7c3aed','#0891b2','#be185d','#65a30d','#ea580c','#0f766e','#6d28d9','#b45309'];
const OC={{'Likely to Win':'#16a34a','Likely to Churn':'#dc2626','Undetermined':'#94a3b8'}};
const SC={{'On Track':'#16a34a','Warning':'#d97706','Attention Required':'#dc2626','Unknown':'#94a3b8'}};
function fmtARR(v){{if(v>=1e6)return'$'+(v/1e6).toFixed(1)+'M';if(v>=1e3)return'$'+(v/1e3).toFixed(0)+'K';return'$'+v.toFixed(0);}}
let filtered=[...RAW],sortCol='arr',sortDir=-1,activeKpi=null,atRiskFilter=false;
function applyFilters(){{
  const st=document.getElementById('f-stage').value,ow=document.getElementById('f-owner').value,
        pr=document.getElementById('f-product').value,ou=document.getElementById('f-outcome').value,
        su=document.getElementById('f-status').value;
  filtered=RAW.filter(r=>
    (!st||r.stage===st)&&(!ow||r.owner===ow)&&(!pr||r.product===pr)&&(!ou||r.outcome===ou)&&
    (!su||r.status===su)&&(!atRiskFilter||['Warning','Attention Required'].includes(r.status))
  );
  renderKPIs();updateCharts();renderTable();
}}
function resetFilters(){{
  ['f-stage','f-owner','f-product','f-outcome','f-status'].forEach(id=>document.getElementById(id).value='');
  atRiskFilter=false;
  ['kpi-all','kpi-win','kpi-churn','kpi-risk'].forEach(id=>document.getElementById(id).classList.remove('active'));
  activeKpi=null;
  document.getElementById('active-tag').classList.remove('show');
  document.getElementById('tbl-title').textContent='All Opportunities';
  applyFilters();
}}
function setActiveTag(label){{
  document.getElementById('active-tag-label').textContent=label;
  document.getElementById('active-tag').classList.add('show');
  document.getElementById('tbl-title').textContent=label;
}}
function chartClick(field,value){{
  // toggle off if same selection
  const selId={{'stage':'f-stage','owner':'f-owner','product':'f-product','outcome':'f-outcome','status':'f-status'}}[field];
  if(selId&&document.getElementById(selId).value===value){{resetFilters();return;}}
  ['f-stage','f-owner','f-product','f-outcome','f-status'].forEach(id=>document.getElementById(id).value='');
  atRiskFilter=false;
  ['kpi-all','kpi-win','kpi-churn','kpi-risk'].forEach(id=>document.getElementById(id).classList.remove('active'));
  activeKpi=null;
  if(selId)document.getElementById(selId).value=value;
  setActiveTag(field.charAt(0).toUpperCase()+field.slice(1)+': '+value);
  applyFilters();
  document.getElementById('tbl-box').scrollIntoView({{behavior:'smooth',block:'start'}});
}}
function kpiClick(kpi){{
  if(activeKpi===kpi){{resetFilters();return;}}
  ['f-stage','f-owner','f-product','f-outcome','f-status'].forEach(id=>document.getElementById(id).value='');
  ['kpi-all','kpi-win','kpi-churn','kpi-risk'].forEach(id=>document.getElementById(id).classList.remove('active'));
  atRiskFilter=false;activeKpi=kpi;
  document.getElementById('kpi-'+kpi).classList.add('active');
  const labels={{'all':'All Opportunities','win':'Likely to Win','churn':'Likely to Churn','risk':'At Risk (Warning + Attention Required)'}};
  if(kpi==='win')document.getElementById('f-outcome').value='Likely to Win';
  else if(kpi==='churn')document.getElementById('f-outcome').value='Likely to Churn';
  else if(kpi==='risk')atRiskFilter=true;
  if(kpi!=='all')setActiveTag(labels[kpi]);
  applyFilters();
  document.getElementById('tbl-box').scrollIntoView({{behavior:'smooth',block:'start'}});
}}
function populateFilters(){{
  const fields={{'f-stage':'stage','f-owner':'owner','f-product':'product','f-outcome':'outcome','f-status':'status'}};
  Object.entries(fields).forEach(([id,field])=>{{
    const sel=document.getElementById(id);
    [...new Set(RAW.map(r=>r[field]))].filter(Boolean).sort().forEach(v=>{{const o=document.createElement('option');o.value=o.textContent=v;sel.appendChild(o);}});
  }});
}}
function renderKPIs(){{
  const s=fn=>filtered.reduce((a,r)=>a+fn(r),0);
  const ct=fn=>filtered.filter(fn).length;
  document.getElementById('k-arr').textContent=fmtARR(s(r=>r.arr));
  document.getElementById('k-count').textContent=filtered.length.toLocaleString()+' opportunities';
  document.getElementById('k-win-arr').textContent=fmtARR(s(r=>r.outcome==='Likely to Win'?r.arr:0));
  document.getElementById('k-win-count').textContent=ct(r=>r.outcome==='Likely to Win').toLocaleString()+' deals';
  document.getElementById('k-churn-arr').textContent=fmtARR(s(r=>r.outcome==='Likely to Churn'?r.arr:0));
  document.getElementById('k-churn-count').textContent=ct(r=>r.outcome==='Likely to Churn').toLocaleString()+' deals';
  document.getElementById('k-risk-arr').textContent=fmtARR(s(r=>['Warning','Attention Required'].includes(r.status)?r.arr:0));
  document.getElementById('k-risk-count').textContent=ct(r=>['Warning','Attention Required'].includes(r.status)).toLocaleString()+' deals';
}}
Chart.register({{
  id:'valueLabels',
  afterDatasetsDraw(chart){{
    const ctx=chart.ctx,horiz=chart.options.indexAxis==='y';
    chart.data.datasets.forEach((ds,di)=>{{
      const meta=chart.getDatasetMeta(di);
      if(meta.hidden)return;
      meta.data.forEach((bar,idx)=>{{
        const val=ds.data[idx];
        if(!val)return;
        ctx.save();
        if(horiz){{
          ctx.font='11px -apple-system,sans-serif';
          ctx.fillStyle='#475569';
          ctx.textAlign='left';
          ctx.textBaseline='middle';
          ctx.fillText(fmtARR(val),bar.x+5,bar.y);
        }}else{{
          const h=bar.base-bar.y;
          if(h<14){{ctx.restore();return;}}
          ctx.font='bold 10px -apple-system,sans-serif';
          ctx.fillStyle='rgba(255,255,255,.9)';
          ctx.textAlign='center';
          ctx.textBaseline='middle';
          ctx.fillText(val>=1e6?'$'+(val/1e6).toFixed(0)+'M':val>=1e3?'$'+(val/1e3).toFixed(0)+'K':'$'+Math.round(val),bar.x,(bar.y+bar.base)/2);
        }}
        ctx.restore();
      }});
    }});
  }}
}});
let charts={{}};
function buildCharts(){{
  try{{charts.outcome=new Chart(document.getElementById('ch-outcome'),{{type:'doughnut',
    data:{{labels:OUTCOME_AGG.map(d=>d.label),datasets:[{{data:OUTCOME_AGG.map(d=>d.arr),backgroundColor:OUTCOME_AGG.map(d=>OC[d.label]||'#94a3b8'),borderColor:'#fff',borderWidth:3}}]}},
    options:{{responsive:true,maintainAspectRatio:false,cutout:'62%',onClick:(evt,els,chart)=>{{if(els.length)chartClick('outcome',chart.data.labels[els[0].index]);}},plugins:{{legend:{{position:'right',onClick:(evt,item,legend)=>{{chartClick('outcome',legend.chart.data.labels[item.index]);}},labels:{{usePointStyle:true,padding:16,font:{{size:12}},generateLabels(chart){{return OUTCOME_AGG.map((item,i)=>{{return{{text:item.label+' ('+item.count+' opps)',fillStyle:OC[item.label]||'#94a3b8',strokeStyle:'#fff',lineWidth:2,index:i,hidden:false}};}});}}}}}}  ,tooltip:{{callbacks:{{label:ctx=>{{const t=ctx.dataset.data.reduce((a,b)=>a+b,0);const cnt=(OUTCOME_AGG[ctx.dataIndex]||{{}}).count||0;return` ${{ctx.label}}: ${{fmtARR(ctx.parsed)}} · ${{cnt}} opps (${{t>0?((ctx.parsed/t)*100).toFixed(1):0}}%)`;}}}}}}}}}}
  }});}}catch(e){{console.error('outcome chart:',e);}}
  try{{charts.stage=new Chart(document.getElementById('ch-stage'),{{type:'bar',
    data:{{labels:STAGE_AGG.map(d=>d.label),datasets:[{{label:'ARR',data:STAGE_AGG.map(d=>d.arr),backgroundColor:PALETTE.map(c=>c+'cc'),borderRadius:4,borderSkipped:false}}]}},
    options:{{indexAxis:'y',responsive:true,maintainAspectRatio:false,onClick:(evt,els,chart)=>{{if(els.length)chartClick('stage',chart.data.labels[els[0].index]);}},plugins:{{legend:{{display:false}},tooltip:{{callbacks:{{label:ctx=>` ${{fmtARR(ctx.parsed.x)}}`}}}}}},scales:{{x:{{ticks:{{callback:v=>fmtARR(v)}},grid:{{color:'#f1f5f9'}}}},y:{{grid:{{display:false}}}}}}}}
  }});}}catch(e){{console.error('stage chart:',e);}}
  try{{charts.product=new Chart(document.getElementById('ch-product'),{{type:'bar',
    data:{{labels:PRODUCT_AGG.map(d=>d.label),datasets:[{{label:'ARR',data:PRODUCT_AGG.map(d=>d.arr),backgroundColor:PALETTE.map(c=>c+'cc'),borderRadius:4,borderSkipped:false}}]}},
    options:{{indexAxis:'y',responsive:true,maintainAspectRatio:false,onClick:(evt,els,chart)=>{{if(els.length)chartClick('product',chart.data.labels[els[0].index]);}},plugins:{{legend:{{display:false}},tooltip:{{callbacks:{{label:ctx=>` ${{fmtARR(ctx.parsed.x)}}`}}}}}},scales:{{x:{{ticks:{{callback:v=>fmtARR(v)}},grid:{{color:'#f1f5f9'}}}},y:{{grid:{{display:false}}}}}}}}
  }});}}catch(e){{console.error('product chart:',e);}}
  try{{charts.owner=new Chart(document.getElementById('ch-owner'),{{type:'bar',
    data:{{labels:OWNER_AGG.map(d=>d.label),datasets:[{{label:'Win',data:OWNER_AGG.map(d=>d.win),backgroundColor:'#16a34acc',borderRadius:4}},{{label:'Churn',data:OWNER_AGG.map(d=>d.churn),backgroundColor:'#dc2626cc',borderRadius:4}},{{label:'Undetermined',data:OWNER_AGG.map(d=>d.count-d.win-d.churn),backgroundColor:'#94a3b8cc',borderRadius:4}}]}},
    options:{{responsive:true,maintainAspectRatio:false,onClick:(evt,els,chart)=>{{if(els.length)chartClick('owner',chart.data.labels[els[0].index]);}},plugins:{{legend:{{position:'top',labels:{{usePointStyle:true,padding:12,font:{{size:11}}}}}}}},scales:{{x:{{stacked:true,grid:{{display:false}},ticks:{{maxRotation:45,callback:function(val){{return this.getLabelForValue(val).split(' ')[0];}}}}}},y:{{stacked:true,grid:{{color:'#f1f5f9'}}}}}}}}
  }});}}catch(e){{console.error('owner chart:',e);}}
  try{{charts.month=new Chart(document.getElementById('ch-month'),{{type:'bar',
    data:{{labels:MONTH_AGG.map(d=>d.label),datasets:[
      {{label:'Win ARR',data:MONTH_AGG.map(d=>d.win),backgroundColor:'#16a34acc',borderRadius:3}},
      {{label:'Churn ARR',data:MONTH_AGG.map(d=>d.churn),backgroundColor:'#dc2626cc',borderRadius:3}},
      {{label:'Undetermined',data:MONTH_AGG.map(d=>d.arr-d.win-d.churn),backgroundColor:'#94a3b8cc',borderRadius:3}}
    ]}},
    options:{{responsive:true,maintainAspectRatio:false,plugins:{{legend:{{position:'top',labels:{{usePointStyle:true,padding:10,font:{{size:10}}}}}},tooltip:{{callbacks:{{label:ctx=>{{const v=ctx.parsed.y;const fmt=v>=1e6?'$'+(v/1e6).toFixed(0)+'M':v>=1e3?'$'+(v/1e3).toFixed(0)+'K':'$'+Math.round(v);return` ${{ctx.dataset.label}}: ${{fmt}}`;}}}}}}}}  ,scales:{{x:{{stacked:true,grid:{{display:false}},ticks:{{maxRotation:45,font:{{size:10}}}}}},y:{{stacked:true,grid:{{color:'#f1f5f9'}},ticks:{{callback:v=>v>=1e6?'$'+(v/1e6).toFixed(0)+'M':v>=1e3?'$'+(v/1e3).toFixed(0)+'K':'$'+Math.round(v)}}}}}}}}
  }});}}catch(e){{console.error('month chart:',e);}}
  try{{charts.status=new Chart(document.getElementById('ch-status'),{{type:'bar',
    data:{{labels:STATUS_AGG.map(d=>d.label),datasets:[{{label:'ARR',data:STATUS_AGG.map(d=>d.arr),backgroundColor:STATUS_AGG.map(d=>SC[d.label]||'#94a3b8'),borderRadius:4,borderSkipped:false}}]}},
    options:{{indexAxis:'y',responsive:true,maintainAspectRatio:false,onClick:(evt,els,chart)=>{{if(els.length)chartClick('status',chart.data.labels[els[0].index]);}},plugins:{{legend:{{display:false}},tooltip:{{callbacks:{{label:ctx=>` ${{fmtARR(ctx.parsed.x)}} · ${{(STATUS_AGG[ctx.dataIndex]||{{}}).count||0}} deals`}}}}}},scales:{{x:{{ticks:{{callback:v=>fmtARR(v)}},grid:{{color:'#f1f5f9'}}}},y:{{grid:{{display:false}}}}}}}}
  }});}}catch(e){{console.error('status chart:',e);}}
}}
function updateCharts(){{
  const agg=(field,fn)=>{{const m={{}};filtered.forEach(r=>{{m[r[field]]=(m[r[field]]||0)+fn(r);}});return m;}};
  const oMap=agg('outcome',r=>r.arr);charts.outcome.data.datasets[0].data=charts.outcome.data.labels.map(l=>oMap[l]||0);charts.outcome.update('none');
  const sMap=agg('stage',r=>r.arr);charts.stage.data.datasets[0].data=charts.stage.data.labels.map(l=>sMap[l]||0);charts.stage.update('none');
  const pMap=agg('product',r=>r.arr);charts.product.data.datasets[0].data=charts.product.data.labels.map(l=>pMap[l]||0);charts.product.update('none');
  const oNames=OWNER_AGG.map(d=>d.label),owMap={{}};
  filtered.forEach(r=>{{if(!owMap[r.owner])owMap[r.owner]={{win:0,churn:0,total:0}};owMap[r.owner].total++;if(r.outcome==='Likely to Win')owMap[r.owner].win++;if(r.outcome==='Likely to Churn')owMap[r.owner].churn++;}});
  charts.owner.data.datasets[0].data=oNames.map(l=>(owMap[l]||{{}}).win||0);
  charts.owner.data.datasets[1].data=oNames.map(l=>(owMap[l]||{{}}).churn||0);
  charts.owner.data.datasets[2].data=oNames.map(l=>{{const o=owMap[l];return o?o.total-o.win-o.churn:0;}});
  charts.owner.update('none');
  // Month chart (static labels, update stacked values)
  if(charts.month){{
    const mMap={{}};
    filtered.forEach(r=>{{const rd=r.renewal_date;if(!rd||rd.length<7)return;const ym=rd.slice(0,7);if(!mMap[ym])mMap[ym]={{win:0,churn:0,total:0}};mMap[ym].total+=r.arr;if(r.outcome==='Likely to Win')mMap[ym].win+=r.arr;if(r.outcome==='Likely to Churn')mMap[ym].churn+=r.arr;}});
    charts.month.data.datasets[0].data=MONTH_AGG.map(d=>( mMap[d.ym]||{{}}).win||0);
    charts.month.data.datasets[1].data=MONTH_AGG.map(d=>(mMap[d.ym]||{{}}).churn||0);
    charts.month.data.datasets[2].data=MONTH_AGG.map(d=>{{const m=mMap[d.ym];return m?m.total-m.win-m.churn:0;}});
    charts.month.update('none');
  }}
  // Status chart
  if(charts.status){{
    const stMap=agg('status',r=>r.arr);
    charts.status.data.datasets[0].data=STATUS_AGG.map(d=>stMap[d.label]||0);
    charts.status.update('none');
  }}
}}
const SF_BASE='https://trilogy-sales.lightning.force.com/lightning/r';
const COLS=[
  {{key:'name',label:'Opportunity',cls:'td-opp',fmt:(v,r)=>`<a class="sf-link" href="${{SF_BASE}}/Opportunity/${{r.id}}/view" target="_blank" title="${{v}}">${{v}}</a>`}},
  {{key:'account',label:'Account',cls:'td-acct',fmt:(v,r)=>r.account_id?`<a class="sf-link" href="${{SF_BASE}}/Account/${{r.account_id}}/view" target="_blank" title="${{v}}">${{v}}</a>`:v}},
  {{key:'owner',label:'Owner',cls:'',fmt:(v)=>v.split(' ')[0]}},
  {{key:'product',label:'Product',cls:'',fmt:(v)=>v}},
  {{key:'stage',label:'Stage',cls:'',fmt:(v)=>`<span class="badge b-stage">${{v}}</span>`}},
  {{key:'outcome',label:'Outcome',cls:'',fmt:(v)=>`<span class="badge ${{v==='Likely to Win'?'b-win':v==='Likely to Churn'?'b-churn':'b-undet'}}">${{v}}</span>`}},
  {{key:'status',label:'Status',cls:'',fmt:(v)=>`<span class="badge ${{v==='On Track'?'b-track':v==='Warning'?'b-warn':v==='Attention Required'?'b-attn':'b-undet'}}">${{v}}</span>`}},
  {{key:'arr',label:'ARR',cls:'',fmt:(v)=>fmtARR(v)}},
  {{key:'renewal_date',label:'Renewal Date',cls:'',fmt:(v)=>v||'—'}},
];
function renderTable(){{
  const sorted=[...filtered].sort((a,b)=>{{const[av,bv]=[a[sortCol],b[sortCol]];return(av<bv?-1:av>bv?1:0)*sortDir*-1;}});
  document.getElementById('tbl-meta').textContent=`Showing ${{Math.min(sorted.length,200)}} of ${{sorted.length}} deals`;
  let html='<table><thead><tr>';
  COLS.forEach(c=>{{
    const active=sortCol===c.key;
    const icon=active?(sortDir===-1?'▼':'▲'):'⇅';
    html+=`<th class="${{active?'sort-active':''}}" onclick="setSort('${{c.key}}')">${{c.label}}<i class="sort-icon">${{icon}}</i></th>`;
  }});
  html+='</tr></thead><tbody>';
  sorted.slice(0,200).forEach(r=>{{html+='<tr>'+COLS.map(c=>`<td class="${{c.cls}}">${{c.fmt(r[c.key],r)}}</td>`).join('')+'</tr>';}});
  if(sorted.length>200)html+=`<tr><td colspan="${{COLS.length}}" style="text-align:center;color:var(--muted);padding:12px">… and ${{sorted.length-200}} more — use filters to narrow down</td></tr>`;
  html+='</tbody></table>';document.getElementById('tbl-wrap').innerHTML=html;
}}
function setSort(col){{sortDir=sortCol===col?sortDir*-1:-1;sortCol=col;renderTable();}}
const REFRESH_IS_GH='{refresh_url}'.startsWith('/api/');
function doRefresh(){{
  const btn=document.getElementById('refresh-btn'),st=document.getElementById('refresh-status');
  btn.disabled=true;btn.textContent='Refreshing…';st.textContent='Connecting…';st.style.color='rgba(255,255,255,.65)';
  fetch('{refresh_url}',{{method:'POST'}})
    .then(r=>{{
      if(!r.ok)throw new Error('Server error '+r.status);
      if(REFRESH_IS_GH){{
        // GitHub Actions dispatch — returns JSON immediately, refresh takes ~2 min
        st.textContent='Queued — data will update in ~2 min';
        btn.disabled=false;btn.textContent='⟳ Refresh';
        return;
      }}
      // Local SSE stream
      if(!r.body)throw new Error('No stream');
      const reader=r.body.getReader(),dec=new TextDecoder();
      let buf='';
      function pump(){{
        reader.read().then(({{done,value}})=>{{
          if(done)return;
          buf+=dec.decode(value,{{stream:true}});
          const chunks=buf.split('\\n\\n');buf=chunks.pop();
          for(const chunk of chunks){{
            for(const line of chunk.split('\\n')){{
              if(!line.startsWith('data: '))continue;
              let d;try{{d=JSON.parse(line.slice(6));}}catch{{continue;}}
              st.textContent=d.msg||'';
              if(d.done){{
                if(d.error){{btn.disabled=false;btn.textContent='⟳ Refresh';st.style.color='#f87171';}}
                else{{st.textContent='Done — reloading…';setTimeout(()=>location.reload(),600);}}
                return;
              }}
            }}
          }}
          pump();
        }}).catch(e=>{{btn.disabled=false;btn.textContent='⟳ Refresh';st.textContent='Error: '+e.message;st.style.color='#f87171';}});
      }}
      pump();
    }})
    .catch(e=>{{btn.disabled=false;btn.textContent='⟳ Refresh';st.textContent='Cannot reach server';st.style.color='#f87171';}});
}}
function toggleChart(h3){{
  const box=h3.closest('.chart-box');
  box.classList.toggle('expanded');
  // Let CSS transition finish then tell Chart.js to resize
  setTimeout(()=>{{
    const canvas=box.querySelector('canvas');
    if(canvas&&canvas.id){{
      const key=canvas.id.replace('ch-','');
      if(charts[key])charts[key].resize();
    }}
  }},260);
}}
try{{populateFilters();}}catch(e){{console.error('populateFilters:',e);}}
try{{renderKPIs();}}catch(e){{console.error('renderKPIs:',e);}}
try{{renderTable();}}catch(e){{console.error('renderTable:',e);}}
try{{buildCharts();}}catch(e){{console.warn('buildCharts:',e);}}
</script>
</body>
</html>"""

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 build_pipeline_dashboard.py <input.json> <output.html> [--refresh-url URL]")
        sys.exit(1)

    input_path, output_path = sys.argv[1], sys.argv[2]
    refresh_url = '/refresh'
    for i, arg in enumerate(sys.argv):
        if arg == '--refresh-url' and i + 1 < len(sys.argv):
            refresh_url = sys.argv[i + 1]

    with open(input_path) as f:
        data = json.load(f)

    raw = data if isinstance(data, list) else data.get("records", [])
    if not raw:
        print("ERROR: No records found in JSON.")
        sys.exit(1)

    # Try to infer export date from filename (e.g. sf_opportunities_20260331_164354.json)
    export_date = datetime.today().strftime("%B %d, %Y")
    for p in os.path.basename(input_path).replace(".json","").split("_"):
        if len(p) == 8 and p.isdigit():
            try:
                export_date = datetime.strptime(p, "%Y%m%d").strftime("%B %d, %Y")
            except ValueError:
                pass

    records = clean_records(raw)
    agg     = aggregate(records)
    html    = build_html(records, agg, export_date, refresh_url=refresh_url)

    with open(output_path, "w") as f:
        f.write(html)

    k = agg["kpis"]
    print(f"✅  Dashboard saved: {output_path}")
    print(f"    Records  : {k['total_count']}")
    print(f"    Total ARR: ${k['total_arr']:,.0f}")
    print(f"    Win ARR  : ${k['win_arr']:,.0f} ({k['win_count']} deals)")
    print(f"    Churn ARR: ${k['churn_arr']:,.0f} ({k['churn_count']} deals)")
    print(f"\n    Open {output_path} in any browser.")


if __name__ == '__main__':
    main()
