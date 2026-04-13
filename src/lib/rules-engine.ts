import {
  SfOpportunityRecord,
  SfTaskRecord,
  QueueStatus,
  RulesEngineResult,
} from "@/types/renewals";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OVERDUE_THRESHOLD_DAYS = 14;
const FOLLOW_UP_THRESHOLD_DAYS = 7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetween(dateStr: string, now: Date): number {
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Find the most recent completed date from a list of tasks.
 * Prefers CompletedDateTime, falls back to ActivityDate.
 */
function mostRecentTaskDate(tasks: SfTaskRecord[]): string | null {
  let latest: string | null = null;
  for (const task of tasks) {
    const date = task.CompletedDateTime ?? task.ActivityDate;
    if (date && (!latest || date > latest)) {
      latest = date;
    }
  }
  return latest;
}

// ---------------------------------------------------------------------------
// Rules engine
// ---------------------------------------------------------------------------

/**
 * Evaluate a single opportunity against the follow-up cadence rules.
 *
 * Inputs:
 *  - opp: the Salesforce opportunity record
 *  - renewalCalls: tasks where Is_Renewal_Call__c = true for this opp
 *  - followUpTasks: completed call/email tasks for this opp
 *  - now: current date (injected for testability)
 *
 * Returns a RulesEngineResult with queueStatus, flagReason, and metadata.
 */
export function evaluateOpportunity(
  opp: SfOpportunityRecord,
  renewalCalls: SfTaskRecord[],
  followUpTasks: SfTaskRecord[],
  now: Date = new Date()
): RulesEngineResult {
  // --- Terminal state: Closed Won or Closed Lost ---
  if (opp.IsClosed) {
    return {
      queueStatus: QueueStatus.NoActionNeeded,
      flagReason: `Opportunity is ${opp.IsWon ? "Closed Won" : "Closed Lost"}. No further follow-up required.`,
      daysSinceLastRenewalCall: null,
      lastContactDate: null,
    };
  }

  // --- No renewal call logged = not eligible ---
  if (renewalCalls.length === 0) {
    // Return null-ish result; the caller should exclude these
    return {
      queueStatus: QueueStatus.NeedsRepReview,
      flagReason:
        "No renewal call has been logged for this opportunity. It is not yet eligible for the follow-up queue. Needs rep review to confirm status.",
      daysSinceLastRenewalCall: null,
      lastContactDate: null,
    };
  }

  // --- Calculate timing ---
  const renewalCallDate = mostRecentTaskDate(renewalCalls);
  const lastFollowUpDate = mostRecentTaskDate(followUpTasks);

  // The "anchor date" is the most recent of: renewal call or last follow-up
  const anchorDate = lastFollowUpDate && lastFollowUpDate > (renewalCallDate ?? "")
    ? lastFollowUpDate
    : renewalCallDate;

  if (!anchorDate) {
    return {
      queueStatus: QueueStatus.NeedsRepReview,
      flagReason:
        "Unable to determine last contact date from activity history. Needs rep review.",
      daysSinceLastRenewalCall: null,
      lastContactDate: null,
    };
  }

  const daysSinceAnchor = daysBetween(anchorDate, now);
  const daysSinceRenewalCall = renewalCallDate
    ? daysBetween(renewalCallDate, now)
    : null;

  // --- Apply rules in priority order ---

  // Recently contacted: follow-up within the last 7 days
  if (daysSinceAnchor < FOLLOW_UP_THRESHOLD_DAYS) {
    return {
      queueStatus: QueueStatus.RecentlyContacted,
      flagReason: `Last contact was ${daysSinceAnchor} day${daysSinceAnchor === 1 ? "" : "s"} ago (${anchorDate.split("T")[0]}). Within the 7-day follow-up window — no action needed yet.`,
      daysSinceLastRenewalCall: daysSinceRenewalCall,
      lastContactDate: anchorDate,
    };
  }

  // Needs follow-up this week: 7–14 days since last contact
  if (daysSinceAnchor <= OVERDUE_THRESHOLD_DAYS) {
    return {
      queueStatus: QueueStatus.NeedsFollowUpThisWeek,
      flagReason: `${daysSinceAnchor} days since last contact (${anchorDate.split("T")[0]}). Falls within the 7–14 day follow-up window. A call or email follow-up is recommended this week.`,
      daysSinceLastRenewalCall: daysSinceRenewalCall,
      lastContactDate: anchorDate,
    };
  }

  // Overdue: more than 14 days since last contact
  return {
    queueStatus: QueueStatus.OverdueFollowUp,
    flagReason: `${daysSinceAnchor} days since last contact (${anchorDate.split("T")[0]}). The 14-day overdue threshold has been exceeded. Immediate follow-up is recommended.`,
    daysSinceLastRenewalCall: daysSinceRenewalCall,
    lastContactDate: anchorDate,
  };
}

/**
 * Evaluate a batch of opportunities and return results keyed by opp ID.
 * Opportunities with no renewal call logged are included with NeedsRepReview
 * status so they surface for manual triage.
 */
export function evaluateAll(
  opportunities: SfOpportunityRecord[],
  renewalCallsByOpp: Map<string, SfTaskRecord[]>,
  followUpByOpp: Map<string, SfTaskRecord[]>,
  now: Date = new Date()
): Map<string, RulesEngineResult> {
  const results = new Map<string, RulesEngineResult>();

  for (const opp of opportunities) {
    const renewalCalls = renewalCallsByOpp.get(opp.Id) ?? [];
    const followUps = followUpByOpp.get(opp.Id) ?? [];

    results.set(opp.Id, evaluateOpportunity(opp, renewalCalls, followUps, now));
  }

  return results;
}
