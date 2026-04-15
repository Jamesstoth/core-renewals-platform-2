/**
 * GET /api/opportunities
 *
 * Returns open renewal opportunities shaped as QueueItem[] for the Signals
 * view (WorkflowQueue + ExpandedDetails). Data comes directly from Salesforce
 * via jsforce — no Supabase dependency.
 */

import { NextResponse } from "next/server";
import { QueueStatus } from "@/types/renewals";
import type { FilterOptions, QueueItem } from "@/types/renewals";
import {
  fetchPipelineFromSalesforce,
} from "@/lib/salesforce-api";
import type { Opportunity } from "@/lib/types";

export const dynamic = "force-dynamic";

const EMPTY_FILTER_OPTIONS: FilterOptions = {
  owners: [],
  stages: [],
  productFamilies: [],
  churnRiskCategories: [],
};

// ---------------------------------------------------------------------------
// Derivations — map gate flags onto QueueStatus
// ---------------------------------------------------------------------------

function deriveQueueStatus(opp: Opportunity): QueueStatus {
  if (opp.is_closed) return QueueStatus.NoActionNeeded;
  if (opp.in_gate4 || opp.in_past_due || opp.in_not_touched) return QueueStatus.OverdueFollowUp;
  if (opp.in_gate3) return QueueStatus.NeedsFollowUpThisWeek;
  if (opp.in_gate1 || opp.in_gate2) return QueueStatus.NeedsRepReview;
  return QueueStatus.NeedsRepReview;
}

function deriveFlagReason(opp: Opportunity): string {
  if (opp.is_closed) return "Closed";
  if (opp.in_gate4) return "Gate 4: renewal date passed, opportunity still open";
  if (opp.in_past_due) return "Past due — renewal date passed";
  if (opp.in_not_touched) return "No activity logged in the last 7+ days (Gate 3)";
  if (opp.in_gate3) return "Gate 3: within 30 days of renewal, not in Finalizing";
  if (opp.in_gate2) return "Gate 2: within 90 days, no quote sent";
  if (opp.in_gate1) return "Gate 1: within 140 days, no engagement";
  return "";
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  return Math.max(0, diff);
}

// ---------------------------------------------------------------------------
// GET /api/opportunities
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const { opportunities } = await fetchPipelineFromSalesforce();

    const openOpps = opportunities.filter(o => !o.is_closed);

    const items: QueueItem[] = openOpps.map((opp) => {
      const arrValue = opp.arr ?? 0;
      return {
        opportunity: {
          id: opp.id,
          accountName: opp.account ?? "Unknown Account",
          opportunityName: opp.name ?? opp.id,
          owner: opp.owner_name ?? "Unassigned",
          stage: opp.stage ?? "",
          renewalDate: opp.renewal_date ?? opp.close_date ?? "",
          closeDate: opp.close_date ?? "",
          arr: arrValue,
          amount: arrValue,
          queueStatus: deriveQueueStatus(opp),
          daysSinceLastRenewalCall: daysSince(opp.last_activity_date),
          flagReason: deriveFlagReason(opp),
          lastContactDate: opp.last_activity_date ?? "",
          nextStepOwner: opp.next_step ?? opp.owner_name ?? "Unassigned",
          renewalCallLogged: false,
          healthScore: opp.health_score,
          churnRiskCategory: opp.churn_risk,
          productFamily: opp.product,
          hasOpenActivity: false,
          hasOverdueTask: false,
          description: opp.description,
        },
        activityHistory: [],
        aiSuggestions: {
          emailDraft: {
            subject: "AI draft pending",
            body: "Email draft will be generated when requested.",
          },
          callObjective: "Call objective will be generated when requested.",
        },
      };
    });

    const owners = new Set<string>();
    const stages = new Set<string>();
    const productFamilies = new Set<string>();
    const churnRiskCategories = new Set<string>();

    for (const opp of openOpps) {
      if (opp.owner_name) owners.add(opp.owner_name);
      if (opp.stage) stages.add(opp.stage);
      if (opp.product) productFamilies.add(opp.product);
      if (opp.churn_risk) churnRiskCategories.add(opp.churn_risk);
    }

    const sort = (s: Set<string>) =>
      Array.from(s).sort((a, b) => a.localeCompare(b));

    const filterOptions: FilterOptions = {
      owners: sort(owners),
      stages: sort(stages),
      productFamilies: sort(productFamilies),
      churnRiskCategories: sort(churnRiskCategories),
    };

    return NextResponse.json({
      items,
      filterOptions,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[/api/opportunities] Error:", message);
    return NextResponse.json(
      { error: message, items: [], filterOptions: EMPTY_FILTER_OPTIONS },
      { status: 500 }
    );
  }
}
