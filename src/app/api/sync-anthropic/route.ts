/**
 * POST /api/sync-anthropic
 *
 * Lightweight sync: fetches opportunity data from Salesforce via a single
 * Anthropic API MCP call and upserts to Supabase. Designed to complete
 * well within Vercel Hobby's 60-second function timeout.
 *
 * Activity history (renewal calls, follow-ups) is NOT fetched here —
 * it can be loaded on-demand when a rep expands an opportunity card.
 * The rules engine uses LastActivityDate from the Opportunity record
 * as a lightweight proxy for follow-up status.
 *
 * Called by:
 *  - Vercel cron (daily at midnight UTC)
 *  - Manual trigger from the portal UI ("Sync Salesforce" button)
 */

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { SfOpportunityRecord } from "@/types/renewals";
import { scoreSfOpportunity } from "@/lib/health-score-adapter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MCP_SERVER_URL = "https://mcp.csaiautomations.com/salesforce/mcp/";

// ---------------------------------------------------------------------------
// SOQL — single query to get all open renewal/upsell opportunities
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

// ---------------------------------------------------------------------------
// Lightweight rules engine (uses LastActivityDate instead of task queries)
// ---------------------------------------------------------------------------

function daysBetween(dateStr: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(dateStr).getTime()) / 86400000);
}

function evaluate(opp: Record<string, unknown>, now: Date) {
  if (opp.IsClosed) {
    return {
      status: "no_action_needed",
      reason: `Opportunity is ${opp.IsWon ? "Closed Won" : "Closed Lost"}.`,
      days: null,
      lastContact: null,
    };
  }

  const lastActivity = opp.LastActivityDate as string | null;
  if (!lastActivity) {
    return {
      status: "needs_rep_review",
      reason: "No activity recorded on this opportunity.",
      days: null,
      lastContact: null,
    };
  }

  const daysSince = daysBetween(lastActivity, now);

  if (daysSince < 7) {
    return {
      status: "recently_contacted",
      reason: `Last activity ${daysSince}d ago (${lastActivity}).`,
      days: daysSince,
      lastContact: lastActivity,
    };
  }
  if (daysSince <= 14) {
    return {
      status: "needs_follow_up_this_week",
      reason: `${daysSince}d since last activity. Follow-up recommended.`,
      days: daysSince,
      lastContact: lastActivity,
    };
  }
  return {
    status: "overdue_follow_up",
    reason: `${daysSince}d since last activity. Overdue.`,
    days: daysSince,
    lastContact: lastActivity,
  };
}

// ---------------------------------------------------------------------------
// Anthropic MCP helper
// ---------------------------------------------------------------------------

async function sfQueryViaMcp(
  client: Anthropic,
  soql: string,
  mcpToken: string,
  label: string
): Promise<Record<string, unknown>[]> {
  console.log(`[sync-anthropic] sfQueryViaMcp(${label}): calling Anthropic API...`);

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
        content: `Use the sf_query tool to run this exact SOQL query and return the raw JSON result with no commentary:\n${soql}`,
      },
    ],
  });

  console.log(`[sync-anthropic] sfQueryViaMcp(${label}): stop_reason=${response.stop_reason}, blocks=${response.content.length}`);

  // Find the MCP tool result
  for (const block of response.content) {
    if (block.type === "mcp_tool_result" && !block.is_error) {
      const items = Array.isArray(block.content) ? block.content : [];
      for (const item of items) {
        if (item.type === "text") {
          let parsed = JSON.parse(item.text);
          if (parsed.content && Array.isArray(parsed.content) && parsed.content[0]?.text) {
            parsed = JSON.parse(parsed.content[0].text);
          }
          const records = (parsed.records as Record<string, unknown>[]) ?? [];
          console.log(`[sync-anthropic] sfQueryViaMcp(${label}): ${records.length} records`);
          return records;
        }
      }
    }
  }

  // Fallback: text block with JSON
  for (const block of response.content) {
    if (block.type === "text") {
      const jsonMatch = block.text.match(/\{[\s\S]*"records"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const records = (parsed.records as Record<string, unknown>[]) ?? [];
        console.log(`[sync-anthropic] sfQueryViaMcp(${label}): ${records.length} records (text fallback)`);
        return records;
      }
    }
  }

  const blockTypes = response.content.map((b: any) => b.type).join(", ");
  throw new Error(`No sf_query result for ${label}. Block types: ${blockTypes}`);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST() {
  const startTime = Date.now();

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const mcpToken = process.env.SALESFORCE_MCP_TOKEN;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    console.log("[sync-anthropic] POST called");
    console.log(`[sync-anthropic] ANTHROPIC_API_KEY: ${apiKey ? "set" : "MISSING"}`);
    console.log(`[sync-anthropic] SALESFORCE_MCP_TOKEN: ${mcpToken ? "set" : "MISSING"}`);
    console.log(`[sync-anthropic] SUPABASE_URL: ${supabaseUrl ? "set" : "MISSING"}`);
    console.log(`[sync-anthropic] SUPABASE_SERVICE_KEY: ${supabaseKey ? "set" : "MISSING"}`);

    if (!apiKey || apiKey === "your-anthropic-api-key") {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
    }
    if (!mcpToken) {
      return NextResponse.json({ error: "SALESFORCE_MCP_TOKEN is not configured" }, { status: 500 });
    }
    if (!supabaseUrl) {
      return NextResponse.json({ error: "SUPABASE_URL is not configured" }, { status: 500 });
    }
    if (!supabaseKey) {
      return NextResponse.json({ error: "SUPABASE_SERVICE_KEY is not configured" }, { status: 500 });
    }

    const anthropic = new Anthropic({ apiKey });
    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- Single Anthropic API call to fetch all opportunities ---
    console.log("[sync-anthropic] Fetching opportunities...");
    const opps = await sfQueryViaMcp(anthropic, OPP_SOQL, mcpToken, "opportunities");
    console.log(`[sync-anthropic] Got ${opps.length} opportunities`);

    if (opps.length === 0) {
      return NextResponse.json({
        ok: true,
        opportunities: 0,
        durationMs: Date.now() - startTime,
      });
    }

    // --- Build Supabase rows with lightweight rules ---
    const now = new Date();
    const rows = opps.map((opp) => {
      const rules = evaluate(opp, now);
      const account = opp.Account as { Name?: string } | null;
      const owner = opp.Owner as { Name?: string } | null;
      const health = scoreSfOpportunity(opp as unknown as SfOpportunityRecord);

      return {
        sf_opportunity_id: opp.Id as string,
        sf_account_id: (opp.AccountId as string) ?? null,
        opportunity_name: opp.Name as string,
        account_name: account?.Name ?? "Unknown Account",
        owner_name: owner?.Name ?? "Unassigned",
        stage: opp.StageName as string,
        renewal_date: (opp.Renewal_Date__c as string) ?? null,
        close_date: opp.CloseDate as string,
        arr: (opp.ARR__c as number) ?? (opp.Amount as number) ?? 0,
        amount: (opp.Amount as number) ?? (opp.ARR__c as number) ?? 0,
        next_step: (opp.NextStep as string) ?? null,
        description: (opp.Description as string) ?? null,
        product_family: (opp.Product__c as string) ?? null,
        is_closed: (opp.IsClosed as boolean) ?? false,
        is_won: (opp.IsWon as boolean) ?? false,
        has_open_activity: (opp.HasOpenActivity as boolean) ?? false,
        has_overdue_task: (opp.HasOverdueTask as boolean) ?? false,
        health_score: Math.round(health.final_score * 10) / 10,
        health_band: health.band,
        health_confidence: health.data_confidence,
        health_overrides: health.overrides_applied.map((o) => o.rule).join("; ") || null,
        churn_risk_category: (opp.AI_Churn_Risk_Category__c as string) ?? null,
        account_report: (opp.Account_Report__c as string) ?? null,
        opportunity_report: (opp.Opportunity_Report__c as string) ?? null,
        support_tickets_summary: (opp.Support_Tickets_Summary__c as string) ?? null,
        last_activity_date: (opp.LastActivityDate as string) ?? null,
        queue_status: rules.status,
        flag_reason: rules.reason,
        days_since_renewal_call: rules.days ?? 0,
        last_contact_date: rules.lastContact ?? null,
        renewal_call_logged: false, // Task data not fetched in lightweight sync
        activity_history: [],       // Loaded on-demand when rep expands a card
        synced_at: now.toISOString(),
      };
    });

    // --- Upsert to Supabase ---
    console.log(`[sync-anthropic] Upserting ${rows.length} rows to Supabase...`);
    const { error: upsertError } = await supabase
      .from("opportunities")
      .upsert(rows, { onConflict: "sf_opportunity_id" });

    if (upsertError) {
      throw new Error(`Supabase upsert failed: ${upsertError.message}`);
    }

    // Mark stale opportunities as closed
    const syncedIds = rows.map((r) => r.sf_opportunity_id);
    const { error: closeError, count: closedCount } = await supabase
      .from("opportunities")
      .update({
        is_closed: true,
        queue_status: "no_action_needed",
        flag_reason: "Closed in Salesforce (detected during sync).",
        synced_at: now.toISOString(),
      })
      .eq("is_closed", false)
      .not("sf_opportunity_id", "in", `(${syncedIds.join(",")})`);

    if (closeError) {
      console.warn(`[sync-anthropic] Warning: failed to close stale records: ${closeError.message}`);
    } else if (closedCount && closedCount > 0) {
      console.log(`[sync-anthropic] Marked ${closedCount} stale opportunities as closed`);
    }

    const durationMs = Date.now() - startTime;
    console.log(`[sync-anthropic] Sync complete in ${durationMs}ms. ${rows.length} opportunities synced.`);

    return NextResponse.json({
      ok: true,
      opportunities: rows.length,
      stalesClosed: closedCount ?? 0,
      durationMs,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[sync-anthropic] Error:", message);
    if (stack) console.error("[sync-anthropic] Stack:", stack);
    const apiErr = err as { status?: number; error?: unknown };
    if (apiErr.status) console.error("[sync-anthropic] HTTP status:", apiErr.status);
    if (apiErr.error) console.error("[sync-anthropic] API error body:", JSON.stringify(apiErr.error));
    return NextResponse.json(
      { error: message, ok: false },
      { status: 500 }
    );
  }
}

// Vercel cron calls GET — proxy to POST
export async function GET() {
  return POST();
}
