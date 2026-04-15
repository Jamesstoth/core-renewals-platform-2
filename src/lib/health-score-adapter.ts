/**
 * Salesforce → Health-Score Engine Adapter
 * ────────────────────────────────────────
 * Translates an `SfOpportunityRecord` (the shape we actually fetch from SF)
 * into the logical `Signals` dict consumed by `health-score-engine.ts`.
 *
 * The engine expects ~35 specialised signals (Open_P1_Count__c, SLA, CSAT,
 * days-past-due, etc.) that the current SF extract does NOT provide. To
 * bridge the gap, this adapter does two things:
 *
 *   1. DIRECT — maps the small number of standard SF fields that correspond
 *      cleanly to engine signals (LastActivityDate, Renewal_Date__c, stage,
 *      auto-renew clause, etc.).
 *
 *   2. EXTRACTED — parses the three AI-generated summary fields
 *      (`Account_Report__c`, `Opportunity_Report__c`, `Support_Tickets_Summary__c`)
 *      for keyword/numeric hints that populate the engine's veto-rule signals.
 *      Extraction is intentionally conservative: we only fill a signal when we
 *      have a fairly unambiguous match. Anything uncertain is left null so the
 *      engine can fall back to neutral.
 *
 * The adapter returns both the `Signals` dict and a `confidence` map showing
 * which signals were populated by direct SF fields vs. extracted from text vs.
 * missing entirely — so downstream code can surface data quality to users.
 */

import type { SfOpportunityRecord } from "@/types/renewals";
import type { Signals } from "./health-score-engine";

// ─────────────────────────────────────────────────────────────────────────────
// Confidence metadata
// ─────────────────────────────────────────────────────────────────────────────

export type SignalProvenance = "direct" | "extracted" | "missing";

export type SignalConfidence = Partial<Record<keyof Signals, SignalProvenance>>;

export interface AdapterResult {
  signals: Signals;
  confidence: SignalConfidence;
}

// ─────────────────────────────────────────────────────────────────────────────
// Text-extraction primitives
// ─────────────────────────────────────────────────────────────────────────────

/** True if any pattern matches the text (case-insensitive). */
function anyMatch(text: string | null | undefined, patterns: RegExp[]): boolean {
  if (!text) return false;
  return patterns.some((p) => p.test(text));
}

/**
 * Extract the first number that appears near a keyword phrase.
 * e.g. extractNumberNear("3 P1 tickets open", /p1/i) → 3
 *      extractNumberNear("SLA adherence: 87%", /sla/i) → 87
 * Returns null if no reliable match is found.
 *
 * Before searching for digits, the matched keyword itself is masked out so
 * that digits which are part of the keyword (e.g. the "1" in "P1") are not
 * mistaken for a signal value. We also require digits to be preceded and
 * followed by a non-word character (or boundary) to avoid matching inside
 * larger tokens.
 */
function extractNumberNear(
  text: string | null | undefined,
  keyword: RegExp,
  opts: { windowChars?: number; allowDecimal?: boolean } = {},
): number | null {
  if (!text) return null;
  const { windowChars = 60, allowDecimal = true } = opts;

  const match = keyword.exec(text);
  if (!match) return null;

  const start = Math.max(0, match.index - windowChars);
  const end = Math.min(text.length, match.index + match[0].length + windowChars);
  const rawWindow = text.slice(start, end);
  const kwPos = match.index - start;
  const kwLen = match[0].length;

  // Mask the keyword out so its own digits don't count.
  const window =
    rawWindow.slice(0, kwPos) +
    " ".repeat(kwLen) +
    rawWindow.slice(kwPos + kwLen);

  const numPattern = allowDecimal
    ? /(?:^|[^\w.])(-?\d+(?:\.\d+)?)(?=[^\w.]|$)/g
    : /(?:^|[^\w.])(-?\d+)(?=[^\w.]|$)/g;

  let best: number | null = null;
  let bestDistance = Infinity;

  let m: RegExpExecArray | null;
  while ((m = numPattern.exec(window)) !== null) {
    // m.index points at the leading non-word char; add its length to reach the digit
    const digitStart = m.index + (m[0].length - m[1].length);
    const dist = Math.abs(digitStart - kwPos);
    if (dist < bestDistance) {
      bestDistance = dist;
      best = parseFloat(m[1]);
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extractors for each AI summary field
// ─────────────────────────────────────────────────────────────────────────────

interface AccountReportExtract {
  has_credit_hold?: boolean;
  has_active_dispute?: boolean;
  has_write_off?: boolean;
  dispute_resolved?: boolean;
  termination_notice?: boolean;
  overdue_ar_pct?: number;
  avg_days_past_due?: number;
}

function extractAccountReport(text: string | null): AccountReportExtract {
  const out: AccountReportExtract = {};
  if (!text) return out;

  if (anyMatch(text, [/credit\s*hold/i, /on\s+hold\s+for\s+(?:non[-\s]?)?payment/i])) {
    out.has_credit_hold = true;
  }

  if (anyMatch(text, [/write[-\s]?off/i, /bad\s+debt/i])) {
    out.has_write_off = true;
  }

  // Termination notice — precise: we only set TRUE for explicit notice to
  // terminate. "may terminate" / "considering termination" are NOT enough.
  if (
    anyMatch(text, [
      /notice\s+(?:of|to)\s+terminat/i,
      /termination\s+notice/i,
      /formally\s+terminat/i,
      /has\s+terminated/i,
      /issued\s+a\s+termination/i,
    ])
  ) {
    out.termination_notice = true;
  }

  // Disputes — distinguish active vs. resolved
  if (anyMatch(text, [/dispute\s+resolved/i, /dispute\s+closed/i, /resolved\s+the\s+dispute/i])) {
    out.dispute_resolved = true;
  } else if (
    anyMatch(text, [
      /active\s+dispute/i,
      /open\s+dispute/i,
      /billing\s+dispute/i,
      /disputing\s+(?:the\s+)?invoice/i,
      /dispute\s+over/i,
    ])
  ) {
    out.has_active_dispute = true;
  }

  // Numeric AR signals
  const arPctMatch = /(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:ar|a\/r|receivables?)?\s*(?:is\s+)?(?:overdue|past[-\s]?due)/i.exec(text);
  if (arPctMatch) {
    const pct = parseFloat(arPctMatch[1]);
    if (!Number.isNaN(pct) && pct >= 0 && pct <= 100) out.overdue_ar_pct = pct;
  }

  const dpd = extractNumberNear(text, /days?\s+past[-\s]?due/i, { allowDecimal: false });
  if (dpd !== null && dpd >= 0 && dpd < 1000) out.avg_days_past_due = dpd;

  return out;
}

interface OpportunityReportExtract {
  open_expansion_opps?: number;
  downgrade_opp_open?: boolean;
  renewal_stage?: string;
  renewal_started?: boolean;
  amendment_type?: string;
}

function extractOpportunityReport(text: string | null): OpportunityReportExtract {
  const out: OpportunityReportExtract = {};
  if (!text) return out;

  // Expansion / upsell detection
  if (anyMatch(text, [/expansion\s+opportunity/i, /upsell\s+in\s+progress/i, /expansion\s+deal/i, /cross[-\s]?sell/i])) {
    out.open_expansion_opps = 1;
    out.amendment_type = "expansion";
  }

  // Downgrade / contraction / seat reduction
  if (
    anyMatch(text, [
      /downgrade/i,
      /seat\s+reduction/i,
      /reducing\s+(?:seats|licenses|users)/i,
      /contraction/i,
      /scope\s+reduction/i,
    ])
  ) {
    out.downgrade_opp_open = true;
    if (!out.amendment_type) out.amendment_type = "reduction";
  }

  // Renewal-stage hints — map free-text to engine's canonical stages
  if (anyMatch(text, [/renewal\s+(?:is\s+)?stalled/i, /no\s+traction\s+on\s+renewal/i, /renewal\s+at\s+risk/i])) {
    out.renewal_stage = "Stalled";
  } else if (anyMatch(text, [/renewal\s+(?:is\s+)?overdue/i, /past\s+renewal\s+date/i])) {
    out.renewal_stage = "Overdue";
  } else if (anyMatch(text, [/renewal\s+on\s+track/i, /quote\s+(?:sent|delivered)/i, /proposal\s+delivered/i])) {
    out.renewal_stage = "On Track";
  }

  if (anyMatch(text, [/renewal\s+(?:conversation|discussion)\s+(?:started|initiated|underway)/i, /kick[-\s]?off(?:ed)?\s+renewal/i])) {
    out.renewal_started = true;
  }

  return out;
}

interface SupportSummaryExtract {
  open_p1_count?: number;
  open_p2_count?: number;
  oldest_p1_hours?: number;
  sla_adherence_pct?: number;
  csat_score?: number;
  nps_category?: string;
  escalation_count_90d?: number;
  ticket_trend_ratio?: number;
}

function extractSupportSummary(text: string | null): SupportSummaryExtract {
  const out: SupportSummaryExtract = {};
  if (!text) return out;

  // P1 / P2 counts — look for "N P1" or "P1: N" patterns
  const p1 = extractNumberNear(text, /\bp(?:riority\s*)?1\b/i, { allowDecimal: false, windowChars: 40 });
  if (p1 !== null && p1 >= 0 && p1 < 100) out.open_p1_count = p1;

  const p2 = extractNumberNear(text, /\bp(?:riority\s*)?2\b/i, { allowDecimal: false, windowChars: 40 });
  if (p2 !== null && p2 >= 0 && p2 < 100) out.open_p2_count = p2;

  // Oldest P1 age — require an explicit hours/days unit so we don't grab
  // unrelated numbers (ticket counts, etc.) from nearby text.
  const hoursMatch = /(\d+)\s*(?:hours?|hrs?)/i.exec(text);
  const daysMatch = /(\d+)\s*days?\s+(?:open|outstanding|unresolved|aged|in\s+queue)/i.exec(text);
  if (hoursMatch) {
    const h = parseInt(hoursMatch[1], 10);
    if (h > 0 && h < 10000) out.oldest_p1_hours = h;
  } else if (daysMatch) {
    const d = parseInt(daysMatch[1], 10);
    if (d > 0 && d < 1000) out.oldest_p1_hours = d * 24;
  }

  // SLA adherence percentage
  const slaMatch = /sla[^.\n]{0,30}?(\d+(?:\.\d+)?)\s*%/i.exec(text);
  if (slaMatch) {
    const pct = parseFloat(slaMatch[1]);
    if (!Number.isNaN(pct) && pct >= 0 && pct <= 100) out.sla_adherence_pct = pct;
  }

  // CSAT — typically 1–5 or percentage
  const csatMatch = /csat[^.\n]{0,30}?(\d+(?:\.\d+)?)/i.exec(text);
  if (csatMatch) {
    const v = parseFloat(csatMatch[1]);
    if (!Number.isNaN(v)) {
      // If on 0-100 scale, convert to 0-5
      if (v > 5 && v <= 100) out.csat_score = v / 20;
      else if (v >= 0 && v <= 5) out.csat_score = v;
    }
  }

  // NPS category
  if (anyMatch(text, [/\bpromoter(s)?\b/i])) out.nps_category = "promoter";
  else if (anyMatch(text, [/\bdetractor(s)?\b/i])) out.nps_category = "detractor";
  else if (anyMatch(text, [/\bpassive(s)?\b/i])) out.nps_category = "passive";

  // Escalations in last 90d
  const esc = extractNumberNear(text, /escalation/i, { allowDecimal: false, windowChars: 40 });
  if (esc !== null && esc >= 0 && esc < 100) out.escalation_count_90d = esc;

  // Ticket trend — "tickets up 40%" → 1.4; "tickets down 20%" → 0.8
  const upMatch = /tickets?\s+(?:up|increased|rose)\s+(\d+(?:\.\d+)?)\s*%/i.exec(text);
  const downMatch = /tickets?\s+(?:down|decreased|fell)\s+(\d+(?:\.\d+)?)\s*%/i.exec(text);
  if (upMatch) {
    const pct = parseFloat(upMatch[1]);
    if (!Number.isNaN(pct)) out.ticket_trend_ratio = 1 + pct / 100;
  } else if (downMatch) {
    const pct = parseFloat(downMatch[1]);
    if (!Number.isNaN(pct)) out.ticket_trend_ratio = Math.max(0, 1 - pct / 100);
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Direct-field mappings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute days-to-expiry from the renewal date.
 * Positive = in the future; negative = already past due.
 */
function computeDaysToExpiry(renewalDate: string | null, today: Date): number | null {
  if (!renewalDate) return null;
  const d = new Date(renewalDate);
  if (Number.isNaN(d.getTime())) return null;
  const ms = d.getTime() - today.getTime();
  return Math.floor(ms / 86400000);
}

/**
 * Map Salesforce `StageName` strings to the engine's canonical
 * `renewal_stage` values ("On Track" | "Stalled" | "Overdue" | "").
 */
function mapSfStageToRenewalStage(stage: string | null): string | null {
  if (!stage) return null;
  const s = stage.toLowerCase();
  if (s.includes("closed won") || s.includes("committed") || s.includes("negotiation")) {
    return "On Track";
  }
  if (s.includes("stalled") || s.includes("on hold")) {
    return "Stalled";
  }
  if (s.includes("overdue") || s.includes("past due")) {
    return "Overdue";
  }
  if (s.includes("prospecting") || s.includes("qualification") || s.includes("discovery")) {
    return "On Track";
  }
  // Unknown stage — leave null so engine uses neutral default
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Additional opportunity fields not on `SfOpportunityRecord` (e.g. from the
 * Python sync path that stores extra fields directly in Supabase). Callers
 * can pass what they have; everything is optional.
 */
export interface AdapterExtras {
  probable_outcome?: string | null;
  auto_renewal_clause?: boolean | null;
  auto_renewed_last_term?: boolean | null;
  active_contacts?: number | null;
  activity_count_30d?: number | null;
}

/**
 * Translate an SF opportunity record into the engine's logical signal dict.
 *
 * @param opp     The SF opportunity record
 * @param extras  Optional supplementary fields (from Supabase / other sources)
 * @param today   Reference date for days-to-expiry calculations (default: now)
 */
export function sfOpportunityToSignals(
  opp: SfOpportunityRecord,
  extras: AdapterExtras = {},
  today: Date = new Date(),
): AdapterResult {
  const signals: Signals = {};
  const confidence: SignalConfidence = {};

  const setDirect = <K extends keyof Signals>(key: K, value: Signals[K]) => {
    if (value !== null && value !== undefined && value !== "") {
      signals[key] = value;
      confidence[key] = "direct";
    }
  };

  const setExtracted = <K extends keyof Signals>(key: K, value: Signals[K]) => {
    if (value !== null && value !== undefined && value !== "") {
      // Don't clobber a direct value with an extracted one
      if (confidence[key] === "direct") return;
      signals[key] = value;
      confidence[key] = "extracted";
    }
  };

  // ── 1. Direct Salesforce field mappings ───────────────────────────────────

  setDirect("last_touchpoint_date", opp.LastActivityDate);
  setDirect("days_to_expiry", computeDaysToExpiry(opp.Renewal_Date__c ?? opp.CloseDate, today));
  setDirect("days_to_renewal", computeDaysToExpiry(opp.Renewal_Date__c ?? opp.CloseDate, today));
  setDirect("renewal_stage", mapSfStageToRenewalStage(opp.StageName));

  // Contract status — infer from IsClosed + IsWon + days-to-expiry
  if (opp.IsClosed) {
    setDirect("contract_status", opp.IsWon ? "Active" : "Expired");
  } else {
    // Open opportunity — likely Active until proven otherwise
    setDirect("contract_status", "Active");
  }

  // Extras (from Supabase / Python sync path)
  setDirect("contract_auto_renew", extras.auto_renewal_clause ?? null);
  setDirect("active_contacts", extras.active_contacts ?? null);
  setDirect("activity_count_30d", extras.activity_count_30d ?? null);

  // Probable_Outcome__c soft-hint for termination (NOT a confirmed veto —
  // we only set termination_notice from explicit text in Account_Report__c)
  const outcome = (extras.probable_outcome ?? "").toLowerCase();
  if (outcome.includes("likely to churn") || outcome.includes("churn")) {
    // Leave termination_notice alone — it's a hard veto rule.
    // Instead, nudge the renewal_stage to Stalled if not already set.
    if (!signals.renewal_stage) setExtracted("renewal_stage", "Stalled");
  }

  // ── 2. Keyword extraction from the three AI summary fields ────────────────

  const acct = extractAccountReport(opp.Account_Report__c);
  if (acct.has_credit_hold !== undefined) setExtracted("has_credit_hold", acct.has_credit_hold);
  if (acct.has_write_off !== undefined) setExtracted("has_write_off", acct.has_write_off);
  if (acct.has_active_dispute !== undefined) setExtracted("has_active_dispute", acct.has_active_dispute);
  if (acct.dispute_resolved !== undefined) setExtracted("dispute_resolved", acct.dispute_resolved);
  if (acct.termination_notice !== undefined) setExtracted("termination_notice", acct.termination_notice);
  if (acct.overdue_ar_pct !== undefined) setExtracted("overdue_ar_pct", acct.overdue_ar_pct);
  if (acct.avg_days_past_due !== undefined) setExtracted("avg_days_past_due", acct.avg_days_past_due);

  const oppRep = extractOpportunityReport(opp.Opportunity_Report__c);
  if (oppRep.open_expansion_opps !== undefined) setExtracted("open_expansion_opps", oppRep.open_expansion_opps);
  if (oppRep.downgrade_opp_open !== undefined) setExtracted("downgrade_opp_open", oppRep.downgrade_opp_open);
  if (oppRep.renewal_stage) setExtracted("renewal_stage", oppRep.renewal_stage);
  if (oppRep.renewal_started !== undefined) setExtracted("renewal_started", oppRep.renewal_started);
  if (oppRep.amendment_type) setExtracted("amendment_type", oppRep.amendment_type);

  const sup = extractSupportSummary(opp.Support_Tickets_Summary__c);
  if (sup.open_p1_count !== undefined) setExtracted("open_p1_count", sup.open_p1_count);
  if (sup.open_p2_count !== undefined) setExtracted("open_p2_count", sup.open_p2_count);
  if (sup.oldest_p1_hours !== undefined) setExtracted("oldest_p1_hours", sup.oldest_p1_hours);
  if (sup.sla_adherence_pct !== undefined) setExtracted("sla_adherence_pct", sup.sla_adherence_pct);
  if (sup.csat_score !== undefined) setExtracted("csat_score", sup.csat_score);
  if (sup.nps_category) setExtracted("nps_category", sup.nps_category);
  if (sup.escalation_count_90d !== undefined) setExtracted("escalation_count_90d", sup.escalation_count_90d);
  if (sup.ticket_trend_ratio !== undefined) setExtracted("ticket_trend_ratio", sup.ticket_trend_ratio);

  // ── 3. Auto-renew prior term → weak positive signal ───────────────────────
  if (extras.auto_renewed_last_term) {
    // If they auto-renewed last term and current contract has AR clause,
    // that's a strong continuity signal — leave contract_status as Active.
  }

  return { signals, confidence };
}

/**
 * Convenience: adapter + engine in one call.
 * Re-exported from `./health-score-engine` to keep import paths clean.
 */
export { scoreOpportunity, scoreBatch, resultToRow } from "./health-score-engine";
export type { HealthResult, Band, DomainScore, DomainName } from "./health-score-engine";

/**
 * Single-shot: SF record → `HealthResult`. Threads adapter output into the
 * engine. This is the function most callers will want.
 */
import { scoreOpportunity as _scoreOpportunity } from "./health-score-engine";
import type { HealthResult, EngineOptions } from "./health-score-engine";

export function scoreSfOpportunity(
  opp: SfOpportunityRecord,
  extras: AdapterExtras = {},
  options: EngineOptions = {},
): HealthResult & { confidence: SignalConfidence } {
  const { signals, confidence } = sfOpportunityToSignals(opp, extras);
  const accountName = opp.Account?.Name ?? opp.Name ?? "Unknown";
  const result = _scoreOpportunity(signals, accountName, options);
  return { ...result, confidence };
}
