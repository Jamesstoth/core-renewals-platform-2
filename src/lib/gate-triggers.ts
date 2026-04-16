/**
 * Renewal Gate & Trigger Framework — backend source of truth.
 *
 * Mirrors the 7-gate lifecycle defined in Renewal_Gate_Trigger_Framework.docx
 * (v1.0 — April 2026). Each gate is expressed as a data structure so the
 * rules engine, REST API, and dashboard UI all consume the same definition.
 *
 * Conventions:
 *  - Days are expressed relative to Renewal_Date__c: T-180 means 180 days
 *    before renewal, T+0 is the renewal date itself.
 *  - `mapsToSupabaseFlag` links each gate violation to the existing
 *    in_gateN / in_not_touched / in_past_due columns populated by the
 *    Python sync (lib/write_to_supabase.py) via config.json SOQL queries.
 *  - `scenarios` on gates 4/5 enumerates the ten closing scenarios from
 *    the Closing Opportunities playbook.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GateId = 'gate0' | 'gate1' | 'gate2' | 'gate3' | 'gate4' | 'gate5' | 'gate6'

export type SfStage =
  | 'Pending'
  | 'Outreach'
  | 'Engaged'
  | 'Proposal'
  | 'Quote Follow Up'
  | 'Finalizing'
  | 'Closed'

export type OwnerRole =
  | 'SDR'
  | 'ISR'
  | 'ERM'
  | 'VP'
  | 'RLC'           // Renewal Legal / Cancellations — Najeeha Humayun
  | 'O2C'           // Order-to-Cash — Keval team
  | 'System'        // Salesforce automation / flow

/**
 * A time-based trigger anchored to Renewal_Date__c.
 *  - `daysBeforeRenewal` is positive for pre-renewal (T-180, T-30, ...),
 *    zero at T+0, negative post-renewal.
 */
export interface TimeTrigger {
  daysBeforeRenewal: number
  label: string         // "T-180", "T-30", "T+0", "T-5 biz days"
  action: string
  /** Optional — the SF automation / scheduled job that actually fires it. */
  source?: string
}

/**
 * An activity-based exit criterion. A gate is cleared when all its
 * activity triggers have been satisfied. Expressed as a human-readable
 * description plus (where available) the SF field or task subject a
 * downstream evaluator can check.
 */
export interface ActivityTrigger {
  description: string
  /** SF field the evaluator inspects, if checkable (e.g. Has_Auto_Renewal_Clause__c). */
  sfField?: string
  /** SF task subject the evaluator looks for, if gate clearance is task-driven. */
  sfTaskSubject?: string
  /** Which playbook / source document this rule traces back to. */
  source?: string
}

/** A Salesforce task required as part of gate execution. */
export interface RequiredTask {
  subject: string
  assignee: OwnerRole
  priority?: number
  description: string
}

/** Condition that fires a gate violation and the escalation that follows. */
export interface GateViolation {
  deadline: string            // e.g. "T-120"
  condition: string           // what counts as unmet
  escalation: string          // who is notified + follow-on action
  /** SF field the automation writes when the gate is breached. */
  violationDateField?: string // e.g. "Gate_3_Violation_Date__c"
}

/** One of the 10 closing scenarios from the Closing Opportunities playbook. */
export interface ClosingScenario {
  number: number
  name: string
  outcome: 'Closed-Won' | 'Closed-Lost' | 'Auto-Renewed' | 'Extension' | 'Escalation' | 'Suspended'
  gate: GateId | GateId[]
  keyAction: string
}

export interface GateDefinition {
  id: GateId
  title: string
  sfStage: SfStage | SfStage[]
  /** Window expressed as labels (e.g. { start: 'T-180', end: 'T-120' }). */
  window: { start: string, end: string }
  /** Primary owners in execution order. */
  owners: OwnerRole[]
  timeTriggers: TimeTrigger[]
  activityTriggers: ActivityTrigger[]
  requiredTasks: RequiredTask[]
  violation: GateViolation
  /** Existing Supabase flag that surfaces violations of this gate, if any. */
  mapsToSupabaseFlag?:
    | 'in_gate1'
    | 'in_gate2'
    | 'in_gate3'
    | 'in_gate4'
    | 'in_not_touched'
    | 'in_past_due'
  /** Closing scenarios handled within this gate (populated for Gates 4 and 5). */
  scenarios?: ClosingScenario[]
  /** Short summary for dashboard tooltips. */
  summary: string
}

// ---------------------------------------------------------------------------
// Critical timeline — hard boundaries across the renewal cycle
// ---------------------------------------------------------------------------

export const CRITICAL_TIMELINE: TimeTrigger[] = [
  { daysBeforeRenewal: 180, label: 'T-180', action: 'Pipeline entry / outreach sequence fires (non-HVO)', source: 'SOQL date window; config.json' },
  { daysBeforeRenewal: 120, label: 'T-120', action: 'Gate 0 deadline — data readiness must be complete',  source: 'SDR task completion' },
  { daysBeforeRenewal: 90,  label: 'T-90',  action: 'Gate 1 deadline — customer must be engaged',        source: 'Stage = Engaged' },
  { daysBeforeRenewal: 60,  label: 'T-60',  action: 'AR notice deadline (60-day clause); Gate 2 deadline', source: 'Has_Auto_Renewal_Clause; Termination Notice Period' },
  { daysBeforeRenewal: 45,  label: 'T-45',  action: 'Quote must be sent to allow evaluation time',       source: 'Stage = Proposal' },
  { daysBeforeRenewal: 30,  label: 'T-30',  action: 'AR invoice auto-fires if no signed quote',          source: 'System automation — 7-condition guard' },
  { daysBeforeRenewal: 7,   label: 'T-7',   action: 'Final disposition: AR execution or Closed-Lost prep', source: 'Win_Type__c determination' },
  { daysBeforeRenewal: 5,   label: 'T-5 biz', action: 'Final warning email for non-AR unresponsive customers', source: 'Closing Scenario #9' },
  { daysBeforeRenewal: 3,   label: 'T-3',   action: 'Close-Win / Auto-Renew task fires',                 source: 'SF task automation' },
  { daysBeforeRenewal: 0,   label: 'T+0',   action: 'Renewal date — all opportunities must be closed',   source: 'No open opps past this date without approved extension' },
]

// ---------------------------------------------------------------------------
// Closing scenarios (referenced by Gates 4 and 5)
// ---------------------------------------------------------------------------

const CLOSING_SCENARIOS: ClosingScenario[] = [
  { number: 1,  name: 'Standard on-time renewal',        outcome: 'Closed-Won',    gate: ['gate4', 'gate5'], keyAction: 'Process signed quote' },
  { number: 2,  name: 'Standard on-time cancellation',   outcome: 'Closed-Lost',   gate: ['gate4', 'gate5'], keyAction: 'Route to cancellations@' },
  { number: 3,  name: 'Customer delay (commitment)',     outcome: 'Extension',     gate: 'gate4',            keyAction: 'Extension form signed' },
  { number: 4,  name: 'Customer delay (no commitment)',  outcome: 'Closed-Lost',   gate: 'gate4',            keyAction: 'De-provisioning ticket' },
  { number: 5,  name: 'Internal delay (our side)',       outcome: 'Escalation',    gate: 'gate4',            keyAction: '2-week extension + internal fix' },
  { number: 6,  name: 'Late signature with AR',          outcome: 'Auto-Renewed',  gate: ['gate4', 'gate5'], keyAction: 'Execute AR at T-7' },
  { number: 7,  name: 'Unresponsive with AR',            outcome: 'Auto-Renewed',  gate: ['gate4', 'gate5'], keyAction: 'Execute AR at T-30' },
  { number: 8,  name: 'Late cancellation with AR',       outcome: 'Auto-Renewed',  gate: ['gate4', 'gate5'], keyAction: 'AR is legally binding' },
  { number: 9,  name: 'Unresponsive without AR',         outcome: 'Closed-Lost',   gate: ['gate4', 'gate5'], keyAction: 'Final notice at T-5 biz days' },
  { number: 10, name: 'Bankruptcy / legal hold',         outcome: 'Suspended',     gate: 'gate2',            keyAction: 'Finance/Legal coordination' },
]

export { CLOSING_SCENARIOS }

// ---------------------------------------------------------------------------
// Gate definitions
// ---------------------------------------------------------------------------

export const GATES: Record<GateId, GateDefinition> = {
  // -------------------------------------------------------------------------
  gate0: {
    id: 'gate0',
    title: 'Data readiness',
    sfStage: 'Pending',
    window: { start: 'T-180', end: 'T-120' },
    owners: ['SDR', 'ISR'],
    summary: 'SDR-owned data enrichment that must be complete before outreach can activate.',
    timeTriggers: [
      { daysBeforeRenewal: 180, label: 'T-180', action: 'Opportunity enters pipeline window via scheduled SOQL', source: 'config.json date window' },
    ],
    activityTriggers: [
      { description: 'Has Auto-Renewal Clause confirmed Yes or No', sfField: 'CurrentContractHasAutoRenewalClause__c', source: 'Auto-Renewal Process playbook' },
      { description: 'Current_ARR__c validated against billing system (NetSuite / Zuora for Kayako)', sfField: 'Current_ARR__c' },
      { description: 'Primary Contact verified: email valid, not opted-out, not bounced', source: 'Hunter.io verification' },
      { description: 'Current subscription data confirmed (ARR, term, success level, subscription ID, renewal date)' },
      { description: 'Last signed quote attached to opportunity files' },
    ],
    requiredTasks: [
      { subject: 'Auto-Renewal Check',           assignee: 'SDR', description: 'Research historical data, find prior signed quote, confirm AR clause status.' },
      { subject: 'Update Current Subscription Data', assignee: 'SDR', description: 'Validate ARR, Term, Success Plan, Renewal Date, and Subscription ID.' },
      { subject: 'Verify Primary Contact',       assignee: 'SDR', description: 'Hunter email check, phone contact, website forms, support, Kayako search.' },
    ],
    violation: {
      deadline: 'T-120',
      condition: 'Data fields remain incomplete at deadline',
      escalation: 'VP notified with summary of missing fields; outreach sequence cannot fire. Repeated failures escalate to infrastructure team.',
      violationDateField: 'Gate_0_Violation_Date__c',
    },
  },

  // -------------------------------------------------------------------------
  gate1: {
    id: 'gate1',
    title: 'Outreach activation',
    sfStage: ['Outreach', 'Pending'],
    window: { start: 'T-120', end: 'T-90' },
    owners: ['ISR', 'ERM', 'System'],
    summary: '140-day no-engagement watch. Automated sequence for non-HVO; ISR/ERM for HVO.',
    mapsToSupabaseFlag: 'in_gate1',
    timeTriggers: [
      { daysBeforeRenewal: 180, label: 'T-180', action: 'Automated outreach sequence fires (non-HVO only)', source: 'System automation' },
      { daysBeforeRenewal: 120, label: 'T-120', action: 'ISR/ERM initiates manual outreach for HVO accounts' },
    ],
    activityTriggers: [
      { description: 'Customer responds: email reply, call scheduled, any correspondence. Stage auto-advances to Engaged on automated-sequence reply.' },
      { description: 'If unresponsive: re-create Verify Primary Contact task; attempt phone, website form, live chat, support channels before escalation.' },
      { description: 'Co-term identification: review active opps for the customer; apply naming convention (1_ABCopp1, 2_ABCopp2, …)' },
      { description: 'Determine co-term eligibility per Co-Terming Policy (acquisition mandate or default).', source: 'Co-Terming Policy playbook' },
    ],
    requiredTasks: [
      { subject: 'Follow-Up with Customer', assignee: 'ISR', description: 'Phone prioritised over email. Log all attempts per call logging guidelines. Leave open until engaged.' },
      { subject: 'Follow-Up Call',          assignee: 'ISR', description: 'Auto-created if initial outreach sequence receives no response.' },
    ],
    violation: {
      deadline: 'T-90',
      condition: 'No customer engagement — stage has not advanced to Engaged',
      escalation: 'VP escalated. AR accounts begin AR preparation track in parallel. Non-AR accounts begin 5-business-day final-warning sequence planning.',
      violationDateField: 'Gate_1_Violation_Date__c',
    },
  },

  // -------------------------------------------------------------------------
  gate2: {
    id: 'gate2',
    title: 'Discovery and needs assessment',
    sfStage: 'Engaged',
    window: { start: 'T-90', end: 'T-60' },
    owners: ['ISR', 'ERM', 'VP'],
    summary: 'Pain Points Playbook call. Deadline aligns with 60-day AR notice period.',
    timeTriggers: [
      { daysBeforeRenewal: 60, label: 'T-60', action: 'Discovery must be complete; AR cancellation right expires for AR customers' },
    ],
    activityTriggers: [
      { description: 'Pain Points Playbook call conducted: Temperature Gauge → Gap Analysis → Validation → Escalation Promise', source: 'Customer Pain Points Playbook' },
      { description: 'Pain Points Sheet updated with specifics (bug counts, feature names, KPI impact) — no generic entries' },
      { description: 'Probable_Outcome__c set to Likely Win / Likely Churn / Undecided', sfField: 'Probable_Outcome__c' },
      { description: 'If redlines / amendments / NDA edits requested: Legal Case created per Legal Workflow playbook', source: 'Renewals Legal Workflow' },
      { description: 'If cancellation notice received: route to cancellations@trilogy.com (SF Case auto-created)', source: 'Cancellations playbook' },
      { description: 'If customer in financial distress / legal hold: coordinate Finance + Legal before proceeding (Scenario #10)' },
    ],
    requiredTasks: [
      { subject: 'Discovery Call',      assignee: 'ISR', description: 'Conduct per Pain Points Playbook flow. Document findings in Pain Points Sheet and Opportunity Description.' },
      { subject: 'Internal Escalation', assignee: 'ISR', description: 'Escalate high pain to Product Owners with documented specifics — fulfils the Escalation Promise.' },
    ],
    violation: {
      deadline: 'T-60',
      condition: 'No discovery call logged',
      escalation: 'Gate_3_Violation_Date__c populated; VP notified. For AR accounts, 60-day notice window has now closed — subsequent cancellation requests must be denied per AR playbook.',
      violationDateField: 'Gate_3_Violation_Date__c',
    },
  },

  // -------------------------------------------------------------------------
  gate3: {
    id: 'gate3',
    title: 'Proposal and pricing',
    sfStage: 'Proposal',
    window: { start: 'T-60', end: 'T-30' },
    owners: ['ISR', 'VP', 'SDR'],
    summary: '90-day quote-not-sent watch. Quote by T-45; AR invoice auto-fires at T-30 if 7 guard conditions are met.',
    mapsToSupabaseFlag: 'in_gate2',
    timeTriggers: [
      { daysBeforeRenewal: 45, label: 'T-45', action: 'Quote must be generated and shared with the customer' },
      { daysBeforeRenewal: 30, label: 'T-30', action: 'AR invoice auto-fires if: AR clause exists, no executed renewal, opp open, not Finalizing, no cancellation notice, no approved override, renewal pricing system-valid', source: 'System automation — 7-condition guard' },
    ],
    activityTriggers: [
      { description: 'Quote created with correct uplift: Standard +25%, Gold +35%, Platinum +45% over Current_ARR__c. AR adds 10% penalty. Price Floor = Floor × 1.25.', source: 'Reviewing and Approving Quotes' },
      { description: 'Quote approval checklist passes: annual billing (monthly only Kayako/Pulse), term 12/36/60 months, NDR ≥ threshold (125/135/145%), currency matches NetSuite, addresses match draft renewal subscription' },
      { description: 'Quote approved and sent via AdobeSign; expiry = max(30 days, renewal date, 7 days)' },
      { description: 'Co-term handling: lead opp identified, children prefixed CT (e.g. CT2_ABCopp2); lead offer aggregates products/quantities per Team+Deployment; separate Offer/AR pairs per Team.' },
      { description: 'If legal case open: status ≥ Review before sending customer-facing quote' },
      { description: 'PO handling: under $100k PO-only → reject, redirect to AdobeSign. Over $100k → validate PO and obtain David H / BU approval.', source: 'Accepting POs playbook' },
    ],
    requiredTasks: [
      { subject: 'Send Quote',                    assignee: 'ISR', description: 'Generate and share quote on Proposal. Complete with Call Result "Completed - Evaluating" and Skip QC checked.' },
      { subject: 'Request Final Quote',           assignee: 'SDR', priority: 10, description: 'Created by SDR once ISR confirms primary quote is accurate and Description is complete.' },
      { subject: 'Vendor Registration',           assignee: 'SDR', priority: 8,  description: 'Manual task created by ISR when vendor registration is required.' },
    ],
    violation: {
      deadline: 'T-30',
      condition: 'No quote sent',
      escalation: 'AR invoice auto-fires for eligible accounts. Owner pre-notifies customer: system-generated AR-priced invoice is coming; ISR is helping them avoid it by locking in agreed pricing before deadline. Exceptions: open legal case, open vendor registration, approved extension.',
      violationDateField: 'Gate_3_Violation_Date__c',
    },
  },

  // -------------------------------------------------------------------------
  gate4: {
    id: 'gate4',
    title: 'Negotiation and follow-up',
    sfStage: 'Quote Follow Up',
    window: { start: 'T-30', end: 'T-7' },
    owners: ['ISR', 'ERM', 'VP'],
    summary: '30-day not-finalizing watch. Automated follow-up sequence; T-5 biz-day final warning for non-AR unresponsive accounts.',
    mapsToSupabaseFlag: 'in_gate3',
    timeTriggers: [
      { daysBeforeRenewal: 30, label: 'T-30', action: 'Stage → Quote Follow Up triggers automated follow-up email sequence' },
      { daysBeforeRenewal: 5,  label: 'T-5 biz', action: 'Send final "service termination" email to non-AR unresponsive customers', source: 'Closing Scenario #9' },
    ],
    activityTriggers: [
      { description: 'Customer signs in AdobeSign → advance to Finalizing, process signed quote (Scenario #1)' },
      { description: 'Customer provides PO instead of signed quote → follow Accepting POs rules (Scenario #2)' },
      { description: 'Customer signs extension commitment form → grant temporary extension (Scenario #3)' },
      { description: 'Customer wants to sign but refuses extension commitment → Closed-Lost, initiate de-provisioning ticket (Scenario #4)' },
      { description: 'Internal delay on our side → 2-week extension + internal escalation (Scenario #5)' },
      { description: 'Customer requests quote changes → loop back to Gate 3' },
      { description: 'Cancellation notice received → route to cancellations@. AR clause + notice deadline passed → deny per AR playbook (Scenario #8). AR + timely notice → process cancellation.' },
    ],
    requiredTasks: [
      { subject: 'Follow-Up with Customer', assignee: 'ISR', description: 'Phone prioritised. Log unsuccessful attempts. Leave open until engaged or gate deadline reached.' },
      { subject: 'Obtain PO',               assignee: 'SDR', priority: 8, description: 'Manual task created by ISR when PO is required.' },
    ],
    violation: {
      deadline: 'T-7',
      condition: 'No signed quote or extension commitment',
      escalation: 'Final disposition: (a) AR + unresponsive → execute Auto-Renewal at T-7 (Scenario #6). (b) AR + late cancel → AR is legally binding (Scenario #8). (c) No AR + unresponsive → prepare Closed-Lost, send Service Terminated notice (Scenario #9).',
      violationDateField: 'Gate_4_Violation_Date__c',
    },
    scenarios: CLOSING_SCENARIOS.filter(s =>
      (Array.isArray(s.gate) ? s.gate.includes('gate4') : s.gate === 'gate4'),
    ),
  },

  // -------------------------------------------------------------------------
  gate5: {
    id: 'gate5',
    title: 'Close execution',
    sfStage: ['Finalizing', 'Closed'],
    window: { start: 'T-7', end: 'T+0' },
    owners: ['ISR', 'SDR', 'VP'],
    summary: '0-day not-closed watch. Disposition + O2C execution. T-3 Close-Win/Auto-Renew task is the final checkpoint.',
    mapsToSupabaseFlag: 'in_gate4',
    timeTriggers: [
      { daysBeforeRenewal: 5, label: 'T-5 (Kayako)', action: 'Kayako opps must be closed-won AR with accurate primary quote at least T-5 for billing processing' },
      { daysBeforeRenewal: 3, label: 'T-3', action: 'Close-Win / Auto-Renew task fires if opportunity not yet closed' },
    ],
    activityTriggers: [
      { description: 'Closed Won (Quote Signed): O2C Invoice Request submitted via Jira, PO obtained where required, Win_Type__c = "Quote Signed", signed quote attached', sfField: 'Win_Type__c' },
      { description: 'Closed Won (Auto-Renew): same term / edition / success level as current; 10% AR penalty on "then current" pricing clauses; customer notified' },
      { description: 'Closed Won (PO Received): O2C processing per Processing Quotes and Invoicing playbook' },
      { description: 'Closed Won (Self-Serve): customer ordered via product portal; selected products only — outside of renewal process' },
      { description: 'Closed Lost: cancellation in writing attached; Loss Reason + Secondary set to root cause (not symptom); VP "Lost" approval; O2C Record Maintenance ticket submitted' },
      { description: "Won't Process: VP-validated as invalid with full backup links (SF, Zuora, NetSuite); added to tracker; Loss Reason = Prime / Duplicate / Handled by BU / Data Quality" },
      { description: 'Co-term close: activate lead renewal subscription; terminate child draft subs (delete products/quotes, set amounts to $0, Win_Type = Co-Term, O2C Record Maintenance)' },
      { description: 'If customer signed after AR processed: update Win_Type, attach signed quote, inform billing, @-mention SDRs in Chatter' },
    ],
    requiredTasks: [
      { subject: 'Request Invoice',        assignee: 'SDR', description: 'Submit O2C Invoice Request when opp enters Finalizing. Exceptions: SLI (email BU ops), Kayako (automatic on close-won).' },
      { subject: 'Close-Win/Auto-Renew',  assignee: 'ISR', description: 'T-3 final disposition. If unresponsive: auto-renew per AR process. If extended: update close date to new deadline.' },
    ],
    violation: {
      deadline: 'T+0',
      condition: 'Opportunity not closed',
      escalation: 'Immediate VP escalation. Non-AR without signed quote → Closed-Lost on renewal date, de-provisioning initiated. AR → process per AR terms. No opportunity may remain open past renewal date without approved extension documented in Description.',
      violationDateField: 'Gate_4_Violation_Date__c',
    },
    scenarios: CLOSING_SCENARIOS.filter(s =>
      (Array.isArray(s.gate) ? s.gate.includes('gate5') : s.gate === 'gate5'),
    ),
  },

  // -------------------------------------------------------------------------
  gate6: {
    id: 'gate6',
    title: 'Post-close QC and feedback loop',
    sfStage: 'Closed',
    window: { start: 'T+0', end: 'T+30' },
    owners: ['VP', 'RLC', 'SDR', 'ISR'],
    summary: 'QC review within 48h; cancellation automation SLA 72h; win/loss analysis feeds next cycle.',
    timeTriggers: [
      { daysBeforeRenewal: -2,  label: 'T+2',  action: 'Follow-up Email 1 sent (from cancellation Initial Response Sent Date)', source: 'Cancellations automation' },
      { daysBeforeRenewal: -4,  label: 'T+4',  action: 'Opportunity auto-submitted for Close Lost approval', source: 'Cancellations automation' },
      { daysBeforeRenewal: -5,  label: 'T+5 biz', action: 'VP QC review deadline (5 business days after close)' },
    ],
    activityTriggers: [
      { description: 'QC Status marked Accepted or Failed with link to QC Record. All closed opps are QC\'d.' },
      { description: 'If QC Failed: re-open to Finalizing, correct quote/invoice, resubmit O2C' },
      { description: 'If Lost: VP reviews Loss Reason accuracy. Must be root cause ("Product issues", "Lack of ROI", "Pricing rigidity"), not symptom.', source: 'Reviewing and Approving Closed Lost Opportunities' },
      { description: 'Cancellation Cases: 72h SLA owned by Najeeha Humayun. Cancellation Confirmation email auto-sent on Closed Lost.' },
      { description: 'Win/loss analysis: refresh AI_Churn_Risk_Category__c inputs, refine engagement playbooks, feed back into next Gate 0 enrichment', sfField: 'AI_Churn_Risk_Category__c' },
    ],
    requiredTasks: [
      { subject: 'QC Review',                   assignee: 'VP',  description: 'Validate Loss Reasons, pricing accuracy, documentation. Accept or reject with feedback.' },
      { subject: 'Cancellation Case Processing', assignee: 'RLC', description: 'End-to-end cancellation processing per playbook — intake to confirmation.' },
      { subject: 'O2C Finalisation',            assignee: 'SDR', description: 'Confirm O2C ticket delivered; post link in O2C Record field on opportunity.' },
    ],
    violation: {
      deadline: 'T+5 biz',
      condition: 'QC not completed within 5 business days OR Cancellation Case not processed within 72h',
      escalation: 'Escalate QC failures to VP; cancellation SLA breaches to Najeeha Humayun. Unresolved QC failures cause downstream CEO Dashboard inaccuracies.',
      violationDateField: 'Gate_6_Violation_Date__c',
    },
  },
}

// ---------------------------------------------------------------------------
// Supabase flag → gate lookup (used by the dashboard to explain violations)
// ---------------------------------------------------------------------------

export const SUPABASE_FLAG_TO_GATE: Record<string, GateId | null> = {
  in_gate1:       'gate1',  // 140D no engagement → Gate 1 violation
  in_gate2:       'gate3',  // 90D quote not sent → Gate 3 violation
  in_gate3:       'gate4',  // 30D not finalizing → Gate 4 violation
  in_gate4:       'gate5',  // 0D not closed      → Gate 5 violation
  in_not_touched: null,     // orthogonal — activity-gap watch across gates
  in_past_due:    'gate5',  // renewal date passed → Gate 5 violation
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getGate(id: GateId): GateDefinition {
  return GATES[id]
}

/**
 * Return the gate that a Supabase in_* flag surfaces, or null when the flag
 * is orthogonal to the 7-gate framework (e.g. in_not_touched).
 */
export function gateForFlag(flag: string): GateDefinition | null {
  const id = SUPABASE_FLAG_TO_GATE[flag]
  return id ? GATES[id] : null
}

/**
 * Given the number of days until Renewal_Date__c (positive = future, negative
 * = past), return the gate whose window contains that point in time.
 */
export function gateForDaysToRenewal(daysToRenewal: number): GateDefinition | null {
  if (daysToRenewal >  120) return GATES.gate0
  if (daysToRenewal >   90) return GATES.gate1
  if (daysToRenewal >   60) return GATES.gate2
  if (daysToRenewal >   30) return GATES.gate3
  if (daysToRenewal >    7) return GATES.gate4
  if (daysToRenewal >=   0) return GATES.gate5
  if (daysToRenewal >= -30) return GATES.gate6
  return null
}

/** Ordered list for iteration / table rendering. */
export const GATE_ORDER: GateId[] = ['gate0', 'gate1', 'gate2', 'gate3', 'gate4', 'gate5', 'gate6']
