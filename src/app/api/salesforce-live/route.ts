/**
 * GET /api/salesforce-live
 *
 * Fetches renewal/upsell opportunities directly from Salesforce via the
 * Anthropic API MCP connector — no Supabase cache involved.
 *
 * Returns the same { items, filterOptions } shape as /api/opportunities
 * so the frontend can swap between them.
 */

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { FilterOptions, QueueItem, SfOpportunityRecord } from "@/types/renewals";
import { scoreSfOpportunity } from "@/lib/health-score-adapter";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // allow up to 60s for multiple MCP round-trips

const MCP_SERVER_URL = "https://mcp.csaiautomations.com/salesforce/mcp/";

const EMPTY: { items: QueueItem[]; filterOptions: FilterOptions } = {
  items: [],
  filterOptions: { owners: [], stages: [], productFamilies: [], churnRiskCategories: [] },
};

// ---------------------------------------------------------------------------
// SOQL (same as lib/sync.ts)
// ---------------------------------------------------------------------------

const OPP_SOQL = `
  SELECT Id, Name, AccountId, Account.Name, OwnerId, Owner.Name,
    StageName, Renewal_Date__c, CloseDate, ARR__c, Amount,
    LastActivityDate, Next_Follow_Up_Date__c, NextStep,
    IsClosed, IsWon, HasOpenActivity, HasOverdueTask,
    Health_Score__c, AI_Churn_Risk_Category__c, Priority_Score__c, Product__c,
    Account_Report__c, Opportunity_Report__c, Support_Tickets_Summary__c
  FROM Opportunity
  WHERE IsClosed = false AND Type IN ('Renewal', 'Upsell')
  ORDER BY CloseDate ASC
  LIMIT 200
`.trim();

const TASK_FIELDS =
  "Id, Subject, Status, Type, TaskSubtype, ActivityDate, CompletedDateTime, Description, Owner.Name, WhatId, Is_Renewal_Call__c, Work_Unit_Type__c, CallType, CallDurationInSeconds";

function renewalCallSOQL(ids: string[]): string {
  return `SELECT ${TASK_FIELDS} FROM Task WHERE WhatId IN (${ids.map((i) => `'${i}'`).join(",")}) AND Is_Renewal_Call__c = true ORDER BY CompletedDateTime DESC`;
}

function followUpSOQL(ids: string[]): string {
  return `SELECT ${TASK_FIELDS} FROM Task WHERE WhatId IN (${ids.map((i) => `'${i}'`).join(",")}) AND Type IN ('Call', 'Email') AND Status = 'Completed' ORDER BY CompletedDateTime DESC`;
}

// ---------------------------------------------------------------------------
// Rules engine (same as lib/sync.ts)
// ---------------------------------------------------------------------------

function daysBetween(dateStr: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(dateStr).getTime()) / 86400000);
}

function mostRecentDate(tasks: Record<string, unknown>[]): string | null {
  let latest: string | null = null;
  for (const t of tasks) {
    const d = (t.CompletedDateTime ?? t.ActivityDate) as string | null;
    if (d && (!latest || d > latest)) latest = d;
  }
  return latest;
}

function evaluate(
  opp: Record<string, unknown>,
  renewalCalls: Record<string, unknown>[],
  followUps: Record<string, unknown>[],
  now: Date
) {
  if (opp.IsClosed) {
    return { status: "no_action_needed", reason: `Opportunity is ${opp.IsWon ? "Closed Won" : "Closed Lost"}.`, days: null, lastContact: null };
  }
  if (renewalCalls.length === 0) {
    return { status: "needs_rep_review", reason: "No renewal call logged. Not yet eligible for follow-up queue.", days: null, lastContact: null };
  }
  const rcDate = mostRecentDate(renewalCalls);
  const fuDate = mostRecentDate(followUps);
  const anchor = fuDate && fuDate > (rcDate ?? "") ? fuDate : rcDate;
  if (!anchor) {
    return { status: "needs_rep_review", reason: "Unable to determine last contact date.", days: null, lastContact: null };
  }
  const daysSince = daysBetween(anchor, now);
  const daysRc = rcDate ? daysBetween(rcDate, now) : null;

  if (daysSince < 7) {
    return { status: "recently_contacted", reason: `Last contact ${daysSince}d ago (${anchor.split("T")[0]}).`, days: daysRc, lastContact: anchor };
  }
  if (daysSince <= 14) {
    return { status: "needs_follow_up_this_week", reason: `${daysSince}d since last contact. Follow-up recommended.`, days: daysRc, lastContact: anchor };
  }
  return { status: "overdue_follow_up", reason: `${daysSince}d since last contact. Overdue.`, days: daysRc, lastContact: anchor };
}

// ---------------------------------------------------------------------------
// Anthropic MCP helper — runs a SOQL query via the MCP connector
// ---------------------------------------------------------------------------

async function sfQueryViaMcp(
  client: Anthropic,
  soql: string,
  mcpToken: string,
  label: string = "query"
): Promise<Record<string, unknown>[]> {
  console.log(`[salesforce-live] sfQueryViaMcp(${label}): calling Anthropic API...`);

  const response = await (client.beta.messages.create as any)({
    model: "claude-sonnet-4-20250514",
    max_tokens: 16384,
    betas: ["mcp-client-2025-11-20"],
    mcp_servers: [
      {
        type: "url",
        url: MCP_SERVER_URL,
        name: "salesforce",
        authorization_token: mcpToken,
      },
    ],
    tools: [
      {
        type: "mcp_toolset",
        mcp_server_name: "salesforce",
      },
    ],
    messages: [
      {
        role: "user",
        content:
          `Use the sf_query tool to run this exact SOQL query and return the raw JSON result with no commentary:\n${soql}`,
      },
    ],
  });

  console.log(`[salesforce-live] sfQueryViaMcp(${label}): got response, stop_reason=${response.stop_reason}, blocks=${response.content.length}`);

  // Find the MCP tool result in the response
  for (const block of response.content) {
    if (block.type === "mcp_tool_result" && !block.is_error) {
      const items = Array.isArray(block.content) ? block.content : [];
      for (const item of items) {
        if (item.type === "text") {
          let parsed = JSON.parse(item.text);
          // Handle double-wrapped responses
          if (parsed.content && Array.isArray(parsed.content) && parsed.content[0]?.text) {
            parsed = JSON.parse(parsed.content[0].text);
          }
          const records = (parsed.records as Record<string, unknown>[]) ?? [];
          console.log(`[salesforce-live] sfQueryViaMcp(${label}): got ${records.length} records`);
          return records;
        }
      }
    }
  }

  // Fallback: check for text block with JSON (model may inline the result)
  for (const block of response.content) {
    if (block.type === "text") {
      const jsonMatch = block.text.match(/\{[\s\S]*"records"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const records = (parsed.records as Record<string, unknown>[]) ?? [];
        console.log(`[salesforce-live] sfQueryViaMcp(${label}): got ${records.length} records (from text fallback)`);
        return records;
      }
    }
  }

  // Log all block types for debugging
  const blockTypes = response.content.map((b: any) => b.type).join(", ");
  console.error(`[salesforce-live] sfQueryViaMcp(${label}): no records found. Block types: ${blockTypes}`);
  throw new Error(`No sf_query result found in Anthropic response for ${label}. Block types: ${blockTypes}`);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const mcpToken = process.env.SALESFORCE_MCP_TOKEN;

    console.log("[salesforce-live] GET called");
    console.log(`[salesforce-live] ANTHROPIC_API_KEY: ${apiKey ? `set (${apiKey.slice(0, 12)}...)` : "MISSING"}`);
    console.log(`[salesforce-live] SALESFORCE_MCP_TOKEN: ${mcpToken ? `set (${mcpToken.slice(0, 20)}...)` : "MISSING"}`);

    if (!apiKey || apiKey === "your-anthropic-api-key") {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured in Vercel environment variables", ...EMPTY },
        { status: 500 }
      );
    }
    if (!mcpToken) {
      return NextResponse.json(
        { error: "SALESFORCE_MCP_TOKEN is not configured in Vercel environment variables", ...EMPTY },
        { status: 500 }
      );
    }

    const client = new Anthropic({ apiKey });

    // 1. Fetch opportunities
    console.log("[salesforce-live] Fetching opportunities...");
    const opps = await sfQueryViaMcp(client, OPP_SOQL, mcpToken, "opportunities");

    console.log(`[salesforce-live] Got ${opps.length} opportunities`);

    if (opps.length === 0) {
      return NextResponse.json({ ...EMPTY, syncedAt: new Date().toISOString(), source: "live" });
    }

    const oppIds = opps.map((o) => o.Id as string);

    // 2. Fetch tasks in batches of 200 (parallel per batch)
    console.log("[salesforce-live] Fetching tasks...");
    const allRenewalCalls: Record<string, unknown>[] = [];
    const allFollowUps: Record<string, unknown>[] = [];

    for (let i = 0; i < oppIds.length; i += 200) {
      const batch = oppIds.slice(i, i + 200);
      const batchLabel = `batch ${i / 200 + 1}`;
      const [rc, fu] = await Promise.all([
        sfQueryViaMcp(client, renewalCallSOQL(batch), mcpToken, `renewalCalls-${batchLabel}`),
        sfQueryViaMcp(client, followUpSOQL(batch), mcpToken, `followUps-${batchLabel}`),
      ]);
      allRenewalCalls.push(...rc);
      allFollowUps.push(...fu);
    }

    console.log(`[salesforce-live] Got ${allRenewalCalls.length} renewal calls, ${allFollowUps.length} follow-ups`);

    // 3. Group tasks by opportunity
    const rcByOpp = new Map<string, Record<string, unknown>[]>();
    for (const t of allRenewalCalls) {
      const wid = t.WhatId as string;
      rcByOpp.set(wid, [...(rcByOpp.get(wid) ?? []), t]);
    }
    const fuByOpp = new Map<string, Record<string, unknown>[]>();
    for (const t of allFollowUps) {
      const wid = t.WhatId as string;
      fuByOpp.set(wid, [...(fuByOpp.get(wid) ?? []), t]);
    }

    // 4. Apply rules engine and build QueueItems
    const now = new Date();
    const items: QueueItem[] = opps.map((opp) => {
      const rc = rcByOpp.get(opp.Id as string) ?? [];
      const fu = fuByOpp.get(opp.Id as string) ?? [];
      const rules = evaluate(opp, rc, fu, now);

      // Build activity history
      const allActivity = [...rc, ...fu];
      const seen = new Set<string>();
      const deduped = allActivity.filter((t) => {
        const id = t.Id as string;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      deduped.sort((a, b) => {
        const da = ((a.CompletedDateTime ?? a.ActivityDate) as string) ?? "";
        const db = ((b.CompletedDateTime ?? b.ActivityDate) as string) ?? "";
        return db.localeCompare(da);
      });

      const typeMap: Record<string, string> = { Call: "Call", Email: "Email", Meeting: "Meeting" };
      const activityHistory = deduped.map((t) => {
        const notes = (t.Description as string) ?? "";
        return {
          id: t.Id as string,
          date: ((t.CompletedDateTime ?? t.ActivityDate) as string) ?? "",
          type: (typeMap[(t.Type as string) ?? ""] ?? "Internal Note") as "Call" | "Email" | "Meeting" | "Internal Note",
          subject: (t.Subject as string) ?? "(No subject)",
          performedBy: ((t.Owner as { Name?: string })?.Name) ?? "Unknown",
          notes: notes.length > 200 ? notes.slice(0, 200) + "..." : notes,
        };
      });

      const account = opp.Account as { Name?: string } | null;
      const owner = opp.Owner as { Name?: string } | null;
      const health = scoreSfOpportunity(opp as unknown as SfOpportunityRecord);

      return {
        opportunity: {
          id: opp.Id as string,
          accountName: account?.Name ?? "Unknown Account",
          opportunityName: opp.Name as string,
          owner: owner?.Name ?? "Unassigned",
          stage: opp.StageName as string,
          renewalDate: (opp.Renewal_Date__c as string) ?? (opp.CloseDate as string),
          closeDate: opp.CloseDate as string,
          arr: (opp.ARR__c as number) ?? (opp.Amount as number) ?? 0,
          amount: (opp.Amount as number) ?? (opp.ARR__c as number) ?? 0,
          queueStatus: rules.status as QueueItem["opportunity"]["queueStatus"],
          daysSinceLastRenewalCall: rules.days ?? 0,
          flagReason: rules.reason,
          lastContactDate: rules.lastContact ?? (opp.LastActivityDate as string) ?? "",
          nextStepOwner: (opp.NextStep as string) ?? owner?.Name ?? "Unassigned",
          productFamily: (opp.Product__c as string) ?? null,
          healthScore: Math.round(health.final_score * 10) / 10,
          churnRiskCategory: (opp.AI_Churn_Risk_Category__c as string) ?? null,
          renewalCallLogged: rc.length > 0,
          hasOpenActivity: (opp.HasOpenActivity as boolean) ?? false,
          hasOverdueTask: (opp.HasOverdueTask as boolean) ?? false,
          description: (opp.Description as string) ?? null,
          accountReport: (opp.Account_Report__c as string) ?? null,
          opportunityReport: (opp.Opportunity_Report__c as string) ?? null,
          supportTicketsSummary: (opp.Support_Tickets_Summary__c as string) ?? null,
        },
        activityHistory,
        aiSuggestions: {
          emailDraft: { subject: "AI draft pending", body: "Email draft will be generated when requested." },
          callObjective: "Call objective will be generated when requested.",
        },
      };
    });

    // 5. Extract filter options
    const owners = new Set<string>();
    const stages = new Set<string>();
    const productFamilies = new Set<string>();
    const churnRiskCategories = new Set<string>();

    for (const item of items) {
      const o = item.opportunity;
      if (o.owner) owners.add(o.owner);
      if (o.stage) stages.add(o.stage);
      if (o.productFamily) productFamilies.add(o.productFamily);
      if (o.churnRiskCategory) churnRiskCategories.add(o.churnRiskCategory);
    }

    const sort = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));

    const filterOptions: FilterOptions = {
      owners: sort(owners),
      stages: sort(stages),
      productFamilies: sort(productFamilies),
      churnRiskCategories: sort(churnRiskCategories),
    };

    console.log(`[salesforce-live] Success — returning ${items.length} items`);
    return NextResponse.json({
      items,
      filterOptions,
      syncedAt: now.toISOString(),
      source: "live",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[salesforce-live] Error:", message);
    if (stack) console.error("[salesforce-live] Stack:", stack);
    // Also log Anthropic API error details if present
    const apiErr = err as { status?: number; error?: unknown };
    if (apiErr.status) console.error("[salesforce-live] HTTP status:", apiErr.status);
    if (apiErr.error) console.error("[salesforce-live] API error body:", JSON.stringify(apiErr.error));
    return NextResponse.json(
      { error: message, ...EMPTY },
      { status: 500 }
    );
  }
}
