import {
  SfOpportunityRecord,
  SfTaskRecord,
  Opportunity,
  ActivityEntry,
  QueueItem,
  QueueStatus,
} from "@/types/renewals";
import { scoreSfOpportunity } from "./health-score-adapter";

// ---------------------------------------------------------------------------
// SOQL Queries
// ---------------------------------------------------------------------------

/** All open renewal and upsell opportunities. */
export const OPPORTUNITIES_QUERY = `
  SELECT
    Id,
    Name,
    AccountId,
    Account.Name,
    OwnerId,
    Owner.Name,
    StageName,
    Renewal_Date__c,
    CloseDate,
    ARR__c,
    Amount,
    LastActivityDate,
    Next_Follow_Up_Date__c,
    NextStep,
    IsClosed,
    IsWon,
    HasOpenActivity,
    HasOverdueTask,
    Health_Score__c,
    AI_Churn_Risk_Category__c,
    Priority_Score__c,
    Product__c,
    Account_Report__c,
    Opportunity_Report__c,
    Support_Tickets_Summary__c
  FROM Opportunity
  WHERE IsClosed = false
    AND Type IN ('Renewal', 'Upsell')

  ORDER BY CloseDate ASC
`.trim();

/** Max IDs per SOQL IN clause to avoid query length limits. */
const BATCH_SIZE = 200;

const TASK_FIELDS = `
  Id, Subject, Status, Type, TaskSubtype, ActivityDate,
  CompletedDateTime, Description, Owner.Name, WhatId,
  Is_Renewal_Call__c, Work_Unit_Type__c, CallType, CallDurationInSeconds
`.trim();

/**
 * Build batched queries for task lookups.
 * Splits opportunity IDs into groups of BATCH_SIZE to stay within
 * SOQL length limits.
 */
function batchIds(oppIds: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < oppIds.length; i += BATCH_SIZE) {
    batches.push(oppIds.slice(i, i + BATCH_SIZE));
  }
  return batches;
}

export function renewalCallsQueries(oppIds: string[]): string[] {
  return batchIds(oppIds).map((batch) => {
    const ids = batch.map((id) => `'${id}'`).join(",");
    return `SELECT ${TASK_FIELDS} FROM Task WHERE WhatId IN (${ids}) AND Is_Renewal_Call__c = true ORDER BY CompletedDateTime DESC`;
  });
}

export function followUpActivityQueries(oppIds: string[]): string[] {
  return batchIds(oppIds).map((batch) => {
    const ids = batch.map((id) => `'${id}'`).join(",");
    return `SELECT ${TASK_FIELDS} FROM Task WHERE WhatId IN (${ids}) AND Type IN ('Call', 'Email') AND Status = 'Completed' ORDER BY CompletedDateTime DESC`;
  });
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export interface SfQueryResponse {
  totalSize: number;
  done: boolean;
  records: Record<string, unknown>[];
}

/**
 * Parse the MCP sf_query response, unwrapping the double-envelope
 * that the remote MCP server returns.
 */
export function parseSfQueryResponse(mcpResult: unknown): SfQueryResponse {
  if (
    typeof mcpResult === "object" &&
    mcpResult !== null &&
    "records" in mcpResult
  ) {
    return mcpResult as SfQueryResponse;
  }

  if (
    typeof mcpResult === "object" &&
    mcpResult !== null &&
    "content" in mcpResult
  ) {
    const content = (mcpResult as { content: { type: string; text: string }[] })
      .content;
    if (Array.isArray(content) && content.length > 0 && content[0].text) {
      let parsed = JSON.parse(content[0].text);

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "content" in parsed &&
        Array.isArray(parsed.content) &&
        parsed.content.length > 0 &&
        parsed.content[0].text
      ) {
        parsed = JSON.parse(parsed.content[0].text);
      }

      if ("records" in parsed) {
        return parsed as SfQueryResponse;
      }
    }
  }

  throw new Error("Unexpected sf_query response format");
}

// ---------------------------------------------------------------------------
// Data shaping — Salesforce records → portal types
// ---------------------------------------------------------------------------

function sfTaskToActivityEntry(task: SfTaskRecord): ActivityEntry {
  const typeMap: Record<string, ActivityEntry["type"]> = {
    Call: "Call",
    Email: "Email",
    Meeting: "Meeting",
  };
  return {
    id: task.Id,
    date: task.CompletedDateTime ?? task.ActivityDate ?? "",
    type: typeMap[task.Type ?? ""] ?? "Internal Note",
    subject: task.Subject ?? "(No subject)",
    performedBy: task.Owner?.Name ?? "Unknown",
    notes: task.Description ?? "",
  };
}

export function sfOpportunityToPortalOpportunity(
  opp: SfOpportunityRecord,
  queueStatus: QueueStatus,
  flagReason: string,
  daysSinceLastRenewalCall: number | null,
  lastContactDate: string | null,
  renewalCallLogged: boolean
): Opportunity {
  const ownerName = opp.Owner?.Name ?? "Unassigned";
  // Health score is computed in-app by the engine — SF's Health_Score__c is
  // null for every open opportunity. Adapter extracts signals from standard
  // SF fields plus the 3 AI summary fields (Account_Report__c, etc.).
  const health = scoreSfOpportunity(opp);
  return {
    id: opp.Id,
    accountName: opp.Account?.Name ?? "Unknown Account",
    opportunityName: opp.Name,
    owner: ownerName,
    stage: opp.StageName,
    renewalDate: opp.Renewal_Date__c ?? opp.CloseDate,
    closeDate: opp.CloseDate,
    arr: opp.ARR__c ?? opp.Amount ?? 0,
    amount: opp.Amount ?? opp.ARR__c ?? 0,
    queueStatus,
    daysSinceLastRenewalCall: daysSinceLastRenewalCall ?? 0,
    flagReason,
    lastContactDate: lastContactDate ?? opp.LastActivityDate ?? "",
    nextStepOwner: opp.NextStep ?? ownerName,
    productFamily: opp.Product__c ?? null,
    healthScore: Math.round(health.final_score * 10) / 10,
    churnRiskCategory: opp.AI_Churn_Risk_Category__c ?? null,
    renewalCallLogged,
    hasOpenActivity: opp.HasOpenActivity ?? false,
    hasOverdueTask: opp.HasOverdueTask ?? false,
    description: null, // Description is stored directly in Supabase, not on SfOpportunityRecord
    accountReport: opp.Account_Report__c ?? null,
    opportunityReport: opp.Opportunity_Report__c ?? null,
    supportTicketsSummary: opp.Support_Tickets_Summary__c ?? null,
  };
}

export function groupTasksByOpportunity(
  tasks: SfTaskRecord[]
): Map<string, SfTaskRecord[]> {
  const map = new Map<string, SfTaskRecord[]>();
  for (const task of tasks) {
    const existing = map.get(task.WhatId) ?? [];
    existing.push(task);
    map.set(task.WhatId, existing);
  }
  return map;
}

export function buildQueueItems(
  opportunities: SfOpportunityRecord[],
  renewalCalls: Map<string, SfTaskRecord[]>,
  followUpActivity: Map<string, SfTaskRecord[]>,
  rulesResults: Map<
    string,
    {
      queueStatus: QueueStatus;
      flagReason: string;
      daysSinceLastRenewalCall: number | null;
      lastContactDate: string | null;
    }
  >
): QueueItem[] {
  return opportunities
    .filter((opp) => rulesResults.has(opp.Id))
    .map((opp) => {
      const rules = rulesResults.get(opp.Id)!;
      const hasRenewalCall = (renewalCalls.get(opp.Id) ?? []).length > 0;
      const activity = [
        ...(renewalCalls.get(opp.Id) ?? []),
        ...(followUpActivity.get(opp.Id) ?? []),
      ];

      const seen = new Set<string>();
      const dedupedActivity = activity.filter((t) => {
        if (seen.has(t.Id)) return false;
        seen.add(t.Id);
        return true;
      });
      dedupedActivity.sort((a, b) => {
        const dateA = a.CompletedDateTime ?? a.ActivityDate ?? "";
        const dateB = b.CompletedDateTime ?? b.ActivityDate ?? "";
        return dateB.localeCompare(dateA);
      });

      return {
        opportunity: sfOpportunityToPortalOpportunity(
          opp,
          rules.queueStatus,
          rules.flagReason,
          rules.daysSinceLastRenewalCall,
          rules.lastContactDate,
          hasRenewalCall
        ),
        activityHistory: dedupedActivity.map(sfTaskToActivityEntry),
        aiSuggestions: {
          emailDraft: {
            subject: "AI draft pending",
            body: "Email draft will be generated when the Anthropic API integration is connected.",
          },
          callObjective:
            "Call objective will be generated when the Anthropic API integration is connected.",
        },
      };
    });
}
