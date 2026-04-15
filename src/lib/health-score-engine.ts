/**
 * Customer Health Score Engine
 * ────────────────────────────
 * TypeScript port of `~/claude/kpi-tools/kpi-tools.py`.
 *
 * Computes a weighted composite health score (0–100) from signals across
 * four domains:
 *
 *   Salesforce CRM     35% — engagement, pipeline, stakeholders, renewal
 *   Support            25% — tickets, SLA, CSAT, escalations
 *   NetSuite / Finance 25% — payment, AR, revenue trend, credit risk
 *   Legal              15% — contract status, amendments, compliance, disputes
 *
 * The engine is pure: it accepts a logical `Signals` dict and returns a
 * `HealthResult`. Mapping from `SfOpportunityRecord` → `Signals` lives in
 * `health-score-adapter.ts` so the engine has zero coupling to Salesforce.
 *
 * Hard veto rules (after the weighted composite is computed):
 *   1. Termination notice received → set to 5
 *   2. Active litigation or breach → cap at 30
 *   3. Credit hold or write-off    → cap at 35
 *   4. Open P1 ticket > 72 hours   → cap at 45
 *   5. Renewal closed early + expansion → floor at 80
 *
 * Bands: Healthy ≥ 80, Caution 50–79, At Risk < 50.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const WEIGHTS = {
  salesforce: 0.35,
  support: 0.25,
  netsuite: 0.25,
  legal: 0.15,
} as const;

export type DomainName = keyof typeof WEIGHTS;

// ─────────────────────────────────────────────────────────────────────────────
// 2. TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Logical signal dict — domain-agnostic input to the engine.
 * Every field is optional; missing/null values trigger neutral fill or
 * weight redistribution depending on engine options.
 */
export interface Signals {
  // -- Salesforce / CRM --
  last_touchpoint_date?: string | null;
  open_expansion_opps?: number | null;
  recent_closed_won?: boolean | null;
  downgrade_opp_open?: boolean | null;
  active_contacts?: number | null;
  has_exec_sponsor?: boolean | null;
  renewal_stage?: string | null;
  days_to_expiry?: number | null;
  renewal_closed_days_early?: number | null;
  activity_trend_30d?: number | null;
  activity_count_30d?: number | null;

  // -- Support --
  open_p1_count?: number | null;
  open_p2_count?: number | null;
  oldest_p1_hours?: number | null;
  sla_adherence_pct?: number | null;
  ticket_trend_ratio?: number | null;
  csat_score?: number | null;
  nps_category?: string | null;
  escalation_count_90d?: number | null;

  // -- NetSuite / Financial --
  avg_days_past_due?: number | null;
  overdue_ar_pct?: number | null;
  yoy_revenue_change_pct?: number | null;
  acv_percentile?: number | null;
  has_credit_hold?: boolean | null;
  has_active_dispute?: boolean | null;
  has_write_off?: boolean | null;
  dispute_resolved?: boolean | null;

  // -- Legal --
  contract_status?: string | null;
  contract_auto_renew?: boolean | null;
  days_to_renewal?: number | null;
  renewal_started?: boolean | null;
  amendment_type?: string | null;
  compliance_status?: string | null;
  litigation_status?: string | null;
  terms_deviation?: string | null;
  termination_notice?: boolean | null;
}

export type Band = "Healthy" | "Caution" | "At Risk";

export interface SubScore {
  signal_name: string;
  raw_value: unknown;
  score: number; // 0–100
  weight: number; // sub-weight within the domain
  weighted: number; // score * weight
}

export interface DomainScore {
  domain: DomainName;
  score: number; // 0–100 (weighted sum of sub-scores)
  weight: number; // domain weight (e.g. 0.35)
  contribution: number; // score * weight
  signals: SubScore[];
  data_present: boolean; // false if all signals were missing
}

export interface Override {
  rule: string;
  action: "cap" | "floor" | "set";
  threshold: number;
  reason: string;
}

export interface HealthResult {
  account_name: string;
  raw_composite: number; // before overrides
  final_score: number; // after overrides & clamping
  band: Band;
  domains: Record<DomainName, DomainScore>;
  overrides_applied: Override[];
  data_confidence: number; // 0–1
  scored_at: string; // ISO timestamp
}

export interface EngineOptions {
  /**
   * Sub-score used when an entire domain has no data.
   * Default 50 (neutral). Ignored if `redistribute_missing` is true.
   */
  neutral_fill?: number;

  /**
   * If true, redistribute weight from entirely-missing domains
   * proportionally onto domains that have data. Default false.
   */
  redistribute_missing?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. HELPER UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function clamp(value: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Read a signal value, returning `defaultValue` if null/undefined. */
function get<K extends keyof Signals>(
  signals: Signals,
  key: K,
  defaultValue: NonNullable<Signals[K]>,
): NonNullable<Signals[K]>;
function get<K extends keyof Signals>(
  signals: Signals,
  key: K,
): Signals[K];
function get<K extends keyof Signals>(
  signals: Signals,
  key: K,
  defaultValue?: NonNullable<Signals[K]>,
): Signals[K] | NonNullable<Signals[K]> | undefined {
  const val = signals[key];
  if (val === null || val === undefined) {
    return defaultValue;
  }
  return val;
}

/** Days between today and a date-like value. Null if missing or unparseable. */
export function daysSince(value: string | Date | null | undefined, today: Date = new Date()): number | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const ms = today.getTime() - d.getTime();
  return Math.floor(ms / 86400000);
}

/**
 * Decay a signal score based on staleness.
 * Reduces by `decay_rate` for every `period_days` since `last_updated`,
 * flooring at `floor_pct` of the original score.
 */
export function applyTimeDecay(
  score: number,
  last_updated: string | Date | null | undefined,
  decay_rate = 0.15,
  period_days = 90,
  floor_pct = 0.5,
): number {
  const days = daysSince(last_updated);
  if (days === null || days <= 0) return score;
  const periods = days / period_days;
  const decay_multiplier = Math.max(floor_pct, Math.pow(1 - decay_rate, periods));
  return score * decay_multiplier;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. DOMAIN SCORERS
// ─────────────────────────────────────────────────────────────────────────────

function scoreSalesforce(signals: Signals): DomainScore {
  const subscores: SubScore[] = [];

  // 4.1a — Engagement recency (30%)
  const days = daysSince(get(signals, "last_touchpoint_date"));
  let s: number;
  if (days === null) s = 50;
  else if (days <= 14) s = 100;
  else if (days <= 30) s = 75;
  else if (days <= 60) s = 40;
  else if (days <= 90) s = 15;
  else s = 0;
  subscores.push({ signal_name: "engagement_recency", raw_value: days, score: s, weight: 0.30, weighted: s * 0.30 });

  // 4.1b — Opportunity pipeline (25%)
  const expansion = get(signals, "open_expansion_opps", 0);
  const recent_cw = get(signals, "recent_closed_won", false);
  const downgrade = get(signals, "downgrade_opp_open", false);
  if (downgrade) s = 0;
  else if (expansion > 0) s = 100;
  else if (recent_cw) s = 60;
  else s = 20;
  subscores.push({ signal_name: "opportunity_pipeline", raw_value: expansion, score: s, weight: 0.25, weighted: s * 0.25 });

  // 4.1c — Stakeholder depth (20%)
  const contacts = get(signals, "active_contacts", 0);
  const has_exec = get(signals, "has_exec_sponsor", false);
  if (has_exec && contacts >= 3) s = 100;
  else if (contacts >= 2) s = 60;
  else if (contacts === 1) s = 25;
  else s = 0;
  subscores.push({ signal_name: "stakeholder_depth", raw_value: contacts, score: s, weight: 0.20, weighted: s * 0.20 });

  // 4.1d — Renewal stage (15%)
  const stage = (get(signals, "renewal_stage") ?? "").toString();
  const closed_early = get(signals, "renewal_closed_days_early");
  const days_to_exp = get(signals, "days_to_expiry");
  const stage_l = stage.toLowerCase();
  if (closed_early !== null && closed_early !== undefined && closed_early >= 60) s = 100;
  else if (stage_l === "on track" || stage_l === "on_track") s = 75;
  else if (stage_l === "stalled" || stage_l === "overdue") s = 20;
  else if (days_to_exp !== null && days_to_exp !== undefined && days_to_exp <= 90 && (stage === "" || stage === "Missing")) s = 0;
  else s = 50;
  subscores.push({ signal_name: "renewal_stage", raw_value: stage, score: s, weight: 0.15, weighted: s * 0.15 });

  // 4.1e — Activity trend (10%)
  const trend = get(signals, "activity_trend_30d");
  const count = get(signals, "activity_count_30d", 0);
  if (count === 0) s = 0;
  else if (trend === null || trend === undefined) s = 50;
  else if (trend >= 1.1) s = 100;
  else if (trend >= 0.9) s = 70;
  else s = 25;
  subscores.push({ signal_name: "activity_trend", raw_value: trend, score: s, weight: 0.10, weighted: s * 0.10 });

  const domain_score = clamp(subscores.reduce((sum, sig) => sum + sig.weighted, 0));
  return {
    domain: "salesforce",
    score: domain_score,
    weight: WEIGHTS.salesforce,
    contribution: domain_score * WEIGHTS.salesforce,
    signals: subscores,
    data_present: true,
  };
}

function scoreSupport(signals: Signals): DomainScore {
  const subscores: SubScore[] = [];
  let s: number;

  // 4.2a — Open ticket severity (30%)
  const p1 = get(signals, "open_p1_count", 0);
  const p2 = get(signals, "open_p2_count", 0);
  const oldest_p1h = get(signals, "oldest_p1_hours", 0);
  if (p1 > 1) s = 0;
  else if (p1 === 1 && oldest_p1h > 24) s = 15;
  else if (p2 >= 1) s = 60;
  else if (p1 === 0 && p2 === 0) s = 100;
  else s = 50;
  subscores.push({ signal_name: "open_ticket_severity", raw_value: { p1, p2 }, score: s, weight: 0.30, weighted: s * 0.30 });

  // 4.2b — SLA adherence (25%)
  const sla = get(signals, "sla_adherence_pct");
  if (sla === null || sla === undefined) s = 50;
  else if (sla >= 95) s = 100;
  else if (sla >= 85) s = 70;
  else if (sla >= 70) s = 40;
  else s = 10;
  subscores.push({ signal_name: "sla_adherence", raw_value: sla, score: s, weight: 0.25, weighted: s * 0.25 });

  // 4.2c — Ticket volume trend (20%)
  const trend = get(signals, "ticket_trend_ratio");
  if (trend === null || trend === undefined) s = 50;
  else if (trend <= 0.9) s = 100;
  else if (trend <= 1.1) s = 75;
  else if (trend <= 1.5) s = 35;
  else s = 0;
  subscores.push({ signal_name: "ticket_volume_trend", raw_value: trend, score: s, weight: 0.20, weighted: s * 0.20 });

  // 4.2d — CSAT / NPS (15%)
  const csat = get(signals, "csat_score");
  const nps = get(signals, "nps_category");
  if (csat !== null && csat !== undefined) {
    if (csat >= 4.5) s = 100;
    else if (csat >= 3.5) s = 60;
    else s = 15;
  } else if (nps !== null && nps !== undefined) {
    const npsLower = String(nps).toLowerCase();
    if (npsLower === "promoter") s = 100;
    else if (npsLower === "passive") s = 60;
    else if (npsLower === "detractor") s = 15;
    else s = 50;
  } else {
    s = 50;
  }
  subscores.push({ signal_name: "csat_nps", raw_value: csat ?? nps, score: s, weight: 0.15, weighted: s * 0.15 });

  // 4.2e — Escalation rate (10%)
  const esc = get(signals, "escalation_count_90d", 0);
  if (esc === 0) s = 100;
  else if (esc === 1) s = 60;
  else if (esc <= 3) s = 25;
  else s = 0;
  subscores.push({ signal_name: "escalation_rate", raw_value: esc, score: s, weight: 0.10, weighted: s * 0.10 });

  const domain_score = clamp(subscores.reduce((sum, sig) => sum + sig.weighted, 0));
  return {
    domain: "support",
    score: domain_score,
    weight: WEIGHTS.support,
    contribution: domain_score * WEIGHTS.support,
    signals: subscores,
    data_present: true,
  };
}

function scoreNetsuite(signals: Signals): DomainScore {
  const subscores: SubScore[] = [];
  let s: number;

  // 4.3a — Payment timeliness (35%)
  const dpd = get(signals, "avg_days_past_due");
  if (dpd === null || dpd === undefined) s = 50;
  else if (dpd <= 0) s = 100;
  else if (dpd <= 15) s = 70;
  else if (dpd <= 45) s = 35;
  else s = 0;
  subscores.push({ signal_name: "payment_timeliness", raw_value: dpd, score: s, weight: 0.35, weighted: s * 0.35 });

  // 4.3b — Outstanding AR (25%)
  const ar_pct = get(signals, "overdue_ar_pct");
  if (ar_pct === null || ar_pct === undefined) s = 50;
  else if (ar_pct < 5) s = 100;
  else if (ar_pct <= 15) s = 65;
  else if (ar_pct <= 30) s = 30;
  else s = 0;
  subscores.push({ signal_name: "outstanding_ar", raw_value: ar_pct, score: s, weight: 0.25, weighted: s * 0.25 });

  // 4.3c — Revenue trend (20%)
  const rev = get(signals, "yoy_revenue_change_pct");
  if (rev === null || rev === undefined) s = 50;
  else if (rev > 10) s = 100;
  else if (rev >= -10) s = 65;
  else if (rev >= -25) s = 30;
  else s = 0;
  subscores.push({ signal_name: "revenue_trend", raw_value: rev, score: s, weight: 0.20, weighted: s * 0.20 });

  // 4.3d — ACV percentile (10%)
  const pctl = get(signals, "acv_percentile");
  if (pctl === null || pctl === undefined) s = 50;
  else if (pctl >= 75) s = 100;
  else if (pctl >= 25) s = 70;
  else s = 40;
  subscores.push({ signal_name: "acv_tier", raw_value: pctl, score: s, weight: 0.10, weighted: s * 0.10 });

  // 4.3e — Credit risk flags (10%)
  const hold = get(signals, "has_credit_hold", false);
  const wo = get(signals, "has_write_off", false);
  const disp_active = get(signals, "has_active_dispute", false);
  const disp_resolved = get(signals, "dispute_resolved", false);
  if (hold || wo) s = 0;
  else if (disp_active) s = 25;
  else if (disp_resolved) s = 70;
  else s = 100;
  subscores.push({
    signal_name: "credit_risk_flags",
    raw_value: { hold, dispute: disp_active },
    score: s,
    weight: 0.10,
    weighted: s * 0.10,
  });

  const domain_score = clamp(subscores.reduce((sum, sig) => sum + sig.weighted, 0));
  return {
    domain: "netsuite",
    score: domain_score,
    weight: WEIGHTS.netsuite,
    contribution: domain_score * WEIGHTS.netsuite,
    signals: subscores,
    data_present: true,
  };
}

function scoreLegal(signals: Signals): DomainScore {
  const subscores: SubScore[] = [];
  let s: number;

  // 4.4a — Contract status (30%)
  const status = (get(signals, "contract_status") ?? "").toString();
  const auto = get(signals, "contract_auto_renew", false);
  const dtr = get(signals, "days_to_renewal");
  const started = get(signals, "renewal_started", false);
  const status_l = status.toLowerCase();
  if ((status_l === "active" || status_l === "autorenew") && auto) s = 100;
  else if (status_l === "active" && (dtr === null || dtr === undefined || dtr > 90)) s = 85;
  else if (dtr !== null && dtr !== undefined && dtr <= 90 && !started) s = 40;
  else if (status_l === "expired" || status_l === "lapsed") s = 0;
  else s = 60;
  subscores.push({ signal_name: "contract_status", raw_value: status, score: s, weight: 0.30, weighted: s * 0.30 });

  // 4.4b — Amendment activity (20%)
  const amend = (get(signals, "amendment_type") ?? "").toString();
  const amend_l = amend.toLowerCase();
  if (amend_l === "expansion") s = 100;
  else if (amend_l === "" || amend_l === "none") s = 75;
  else if (amend_l === "reduction") s = 30;
  else if (amend_l === "termination") s = 0;
  else s = 50;
  subscores.push({ signal_name: "amendment_activity", raw_value: amend, score: s, weight: 0.20, weighted: s * 0.20 });

  // 4.4c — Compliance status (20%)
  const comp = (get(signals, "compliance_status") ?? "").toString();
  const comp_l = comp.toLowerCase();
  if (comp_l === "compliant" || comp_l === "") s = 100;
  else if (comp_l === "minor") s = 60;
  else if (comp_l === "material") s = 20;
  else if (comp_l === "breach") s = 0;
  else s = 50;
  subscores.push({ signal_name: "compliance_status", raw_value: comp, score: s, weight: 0.20, weighted: s * 0.20 });

  // 4.4d — Dispute / litigation (20%)
  const lit = (get(signals, "litigation_status") ?? "").toString();
  const lit_l = lit.toLowerCase();
  if (lit_l === "none" || lit_l === "") s = 100;
  else if (lit_l === "resolved") s = 80;
  else if (lit_l === "active") s = 20;
  else if (lit_l === "filed") s = 0;
  else s = 50;
  subscores.push({ signal_name: "dispute_litigation", raw_value: lit, score: s, weight: 0.20, weighted: s * 0.20 });

  // 4.4e — Terms favorability (10%)
  const terms = (get(signals, "terms_deviation") ?? "").toString();
  const terms_l = terms.toLowerCase();
  if (terms_l === "standard" || terms_l === "") s = 100;
  else if (terms_l === "minor") s = 70;
  else if (terms_l === "significant") s = 40;
  else if (terms_l === "tfc_short" || terms_l === "tfc short") s = 15;
  else s = 50;
  subscores.push({ signal_name: "terms_favorability", raw_value: terms, score: s, weight: 0.10, weighted: s * 0.10 });

  const domain_score = clamp(subscores.reduce((sum, sig) => sum + sig.weighted, 0));
  return {
    domain: "legal",
    score: domain_score,
    weight: WEIGHTS.legal,
    contribution: domain_score * WEIGHTS.legal,
    signals: subscores,
    data_present: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. OVERRIDE / VETO RULES
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateOverrides(signals: Signals, raw_score: number): { score: number; overrides: Override[] } {
  let score = raw_score;
  const overrides: Override[] = [];

  // Rule 1: Termination notice → set to 5 (terminal — no further evaluation)
  if (get(signals, "termination_notice", false)) {
    overrides.push({
      rule: "Termination notice received",
      action: "set",
      threshold: 5,
      reason: "Churn confirmed; score must reflect reality",
    });
    return { score: 5, overrides };
  }

  // Rule 2: Active litigation or breach → cap at 30
  const lit = String(get(signals, "litigation_status") ?? "").toLowerCase();
  const comp = String(get(signals, "compliance_status") ?? "").toLowerCase();
  if (lit === "active" || lit === "filed" || comp === "breach") {
    overrides.push({
      rule: "Active litigation or breach notification",
      action: "cap",
      threshold: 30,
      reason: "Legal risk supersedes positive signals",
    });
    score = Math.min(score, 30);
  }

  // Rule 3: Credit hold or write-off → cap at 35
  if (get(signals, "has_credit_hold", false) || get(signals, "has_write_off", false)) {
    overrides.push({
      rule: "Account on credit hold or write-off",
      action: "cap",
      threshold: 35,
      reason: "Financial distress is an existential churn risk",
    });
    score = Math.min(score, 35);
  }

  // Rule 4: Open P1 > 72 hours → cap at 45
  const p1 = get(signals, "open_p1_count", 0);
  const oldest = get(signals, "oldest_p1_hours", 0);
  if (p1 > 0 && oldest > 72) {
    overrides.push({
      rule: "Open P1 ticket > 72 hours",
      action: "cap",
      threshold: 45,
      reason: "Unresolved critical issue overrides engagement metrics",
    });
    score = Math.min(score, 45);
  }

  // Rule 5: Renewal closed early + expansion → floor at 80
  const closed_early = get(signals, "renewal_closed_days_early");
  const expansion = get(signals, "open_expansion_opps", 0);
  const amend = String(get(signals, "amendment_type") ?? "").toLowerCase();
  if (
    closed_early !== null &&
    closed_early !== undefined &&
    closed_early >= 60 &&
    (expansion > 0 || amend === "expansion")
  ) {
    overrides.push({
      rule: "Renewal closed early + expansion signed",
      action: "floor",
      threshold: 80,
      reason: "Committed customer should not appear at risk",
    });
    score = Math.max(score, 80);
  }

  return { score, overrides };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. DATA CONFIDENCE
// ─────────────────────────────────────────────────────────────────────────────

const ALL_SIGNAL_KEYS: Array<keyof Signals> = [
  "last_touchpoint_date", "open_expansion_opps", "recent_closed_won", "downgrade_opp_open",
  "active_contacts", "has_exec_sponsor", "renewal_stage", "days_to_expiry",
  "renewal_closed_days_early", "activity_trend_30d", "activity_count_30d",
  "open_p1_count", "open_p2_count", "oldest_p1_hours", "sla_adherence_pct",
  "ticket_trend_ratio", "csat_score", "nps_category", "escalation_count_90d",
  "avg_days_past_due", "overdue_ar_pct", "yoy_revenue_change_pct", "acv_percentile",
  "has_credit_hold", "has_active_dispute", "has_write_off", "dispute_resolved",
  "contract_status", "contract_auto_renew", "days_to_renewal", "renewal_started",
  "amendment_type", "compliance_status", "litigation_status", "terms_deviation",
  "termination_notice",
];

/**
 * Return a 0.0–1.0 confidence factor based on how many signal fields
 * are populated. A value of 0 / "" / null counts as missing.
 */
export function computeDataConfidence(signals: Signals): number {
  let present = 0;
  for (const key of ALL_SIGNAL_KEYS) {
    const v = signals[key];
    if (v !== null && v !== undefined && v !== "" && v !== 0 && v !== false) {
      present += 1;
    }
  }
  return Math.round((present / ALL_SIGNAL_KEYS.length) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<EngineOptions> = {
  neutral_fill: 50,
  redistribute_missing: false,
};

/**
 * Score a single opportunity from its logical signals.
 *
 * @param signals     domain-agnostic input dict (see `Signals`)
 * @param accountName label used in the result (cosmetic only)
 * @param options     engine tuning (neutral fill, weight redistribution)
 */
export function scoreOpportunity(
  signals: Signals,
  accountName = "Unknown",
  options: EngineOptions = {},
): HealthResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Score each domain
  const domains: Record<DomainName, DomainScore> = {
    salesforce: scoreSalesforce(signals),
    support: scoreSupport(signals),
    netsuite: scoreNetsuite(signals),
    legal: scoreLegal(signals),
  };

  // Detect entirely-missing domains
  const effective_weights: Record<DomainName, number> = { ...WEIGHTS };
  let missing_weight = 0;
  for (const name of Object.keys(domains) as DomainName[]) {
    const ds = domains[name];
    const all_missing = ds.signals.every((sig) => {
      const v = sig.raw_value;
      return v === null || v === undefined || v === "";
    });
    if (all_missing) {
      ds.data_present = false;
      if (opts.redistribute_missing) {
        missing_weight += effective_weights[name];
        effective_weights[name] = 0;
      } else {
        ds.score = opts.neutral_fill;
      }
    }
  }

  // Redistribute missing weight onto present domains
  if (opts.redistribute_missing && missing_weight > 0) {
    const present_total = (Object.keys(effective_weights) as DomainName[])
      .filter((n) => domains[n].data_present)
      .reduce((sum, n) => sum + effective_weights[n], 0);
    if (present_total > 0) {
      for (const n of Object.keys(effective_weights) as DomainName[]) {
        if (domains[n].data_present) {
          effective_weights[n] *= 1 + missing_weight / present_total;
        }
      }
    }
  }

  // Recalculate contributions with effective weights
  for (const name of Object.keys(domains) as DomainName[]) {
    const ds = domains[name];
    ds.weight = effective_weights[name];
    ds.contribution = ds.score * ds.weight;
  }

  // Composite
  const raw_composite = clamp(
    (Object.keys(domains) as DomainName[]).reduce((sum, n) => sum + domains[n].contribution, 0),
  );

  // Overrides
  const { score: overridden, overrides } = evaluateOverrides(signals, raw_composite);
  const final_score = clamp(overridden);

  // Band
  const band: Band = final_score >= 80 ? "Healthy" : final_score >= 50 ? "Caution" : "At Risk";

  // Confidence
  const confidence = computeDataConfidence(signals);

  return {
    account_name: accountName,
    raw_composite,
    final_score,
    band,
    domains,
    overrides_applied: overrides,
    data_confidence: confidence,
    scored_at: new Date().toISOString(),
  };
}

/** Score a list of (signals, accountName) pairs. */
export function scoreBatch(
  records: Array<{ signals: Signals; accountName?: string }>,
  options: EngineOptions = {},
): HealthResult[] {
  return records.map(({ signals, accountName }) => scoreOpportunity(signals, accountName ?? "Unknown", options));
}

/** Flatten a HealthResult into a row suitable for tables / CSV / Supabase. */
export function resultToRow(result: HealthResult): Record<string, unknown> {
  const row: Record<string, unknown> = {
    account_name: result.account_name,
    health_score: Math.round(result.final_score * 10) / 10,
    raw_composite: Math.round(result.raw_composite * 10) / 10,
    band: result.band,
    data_confidence: result.data_confidence,
    overrides: result.overrides_applied.map((o) => o.rule).join("; ") || "None",
    scored_at: result.scored_at,
  };
  for (const name of Object.keys(result.domains) as DomainName[]) {
    const ds = result.domains[name];
    row[`${name}_score`] = Math.round(ds.score * 10) / 10;
    row[`${name}_contribution`] = Math.round(ds.contribution * 10) / 10;
    row[`${name}_data_present`] = ds.data_present;
  }
  return row;
}
