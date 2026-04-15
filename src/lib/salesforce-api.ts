import jsforce, { Connection } from 'jsforce'
import type { Opportunity, Activity } from '@/lib/types'

let cachedConnection: Connection | null = null
let tokenExpiresAt = 0

/**
 * Returns an authenticated jsforce Connection using the username-password
 * OAuth2 flow. Reuses the connection across requests until the token expires.
 */
export async function getSalesforceConnection(): Promise<Connection> {
  // Reuse connection if token is still valid (with 5-min buffer)
  if (cachedConnection && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedConnection
  }

  const clientId = process.env.SF_CLIENT_ID
  const clientSecret = process.env.SF_CLIENT_SECRET
  const username = process.env.SF_USERNAME
  const password = process.env.SF_PASSWORD
  const securityToken = process.env.SF_SECURITY_TOKEN

  if (!clientId || !clientSecret || !username || !password || !securityToken) {
    throw new Error(
      'Missing Salesforce credentials. Set SF_CLIENT_ID, SF_CLIENT_SECRET, SF_USERNAME, SF_PASSWORD, SF_SECURITY_TOKEN.'
    )
  }

  const conn = new jsforce.Connection({
    oauth2: {
      loginUrl: 'https://login.salesforce.com',
      clientId,
      clientSecret,
    },
  })

  // Salesforce expects password + security token concatenated
  await conn.login(username, `${password}${securityToken}`)

  cachedConnection = conn
  // jsforce doesn't expose token expiry directly; assume 2-hour session
  tokenExpiresAt = Date.now() + 2 * 60 * 60 * 1000

  console.log('[salesforce-api] Authenticated as', username)
  return conn
}

/**
 * Run a SOQL query against Salesforce and return the records array.
 * Handles authentication and auto-retries once on session expiry.
 */
export async function querySalesforce<T extends Record<string, unknown> = Record<string, unknown>>(
  soql: string
): Promise<T[]> {
  let conn = await getSalesforceConnection()

  try {
    const result = await conn.query<T>(soql)
    return result.records
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)

    // If session expired, clear cache and retry once
    if (message.includes('INVALID_SESSION_ID') || message.includes('Session expired')) {
      console.log('[salesforce-api] Session expired, re-authenticating...')
      cachedConnection = null
      tokenExpiresAt = 0
      conn = await getSalesforceConnection()
      const result = await conn.query<T>(soql)
      return result.records
    }

    throw new Error(`Salesforce query failed: ${message}`)
  }
}

// ---------------------------------------------------------------------------
// Shared SOQL field list & record mapper for Opportunity
// ---------------------------------------------------------------------------

const OPP_OWNERS = `('James Stothard', 'Sebastian Desand', 'Tim Courtenay', 'James Quigley', 'Fredrik Scheike')`

export const OPP_FIELDS = [
  'Id', 'Name', 'Owner.Name', 'Owner.Email', 'StageName',
  'Opportunity_Status__c', 'Probable_Outcome__c',
  'ARR__c', 'Current_ARR__c', 'ARR_Increase__c', 'Offer_ARR__c',
  'Renewal_Date__c', 'CloseDate', 'CreatedDate',
  'LastActivityDate', 'LastModifiedDate', 'Next_Follow_Up_Date__c',
  'AI_Churn_Risk_Category__c', 'Health_Score__c', 'Priority_Score__c',
  'Success_Level__c', 'Current_Success_Level__c',
  'CurrentContractHasAutoRenewalClause__c', 'Auto_Renewed_Last_Term__c',
  'Product__c', 'Account.Name',
  'Churn_Risks__c', 'High_Value_Opp__c', 'Handled_by_BU__c',
  'IsClosed', 'Win_Type__c', 'Type', 'NextStep', 'Description',
  'Gate_3_Violation_Date__c',
].join(', ')

export interface SfOppRecord extends Record<string, unknown> {
  Id: string
  Name: string | null
  Owner: { Name: string | null; Email: string | null } | null
  Account: { Name: string | null } | null
  StageName: string | null
  Opportunity_Status__c: string | null
  Probable_Outcome__c: string | null
  ARR__c: number | null
  Current_ARR__c: number | null
  ARR_Increase__c: number | null
  Offer_ARR__c: number | null
  Renewal_Date__c: string | null
  CloseDate: string | null
  CreatedDate: string | null
  LastActivityDate: string | null
  LastModifiedDate: string | null
  Next_Follow_Up_Date__c: string | null
  AI_Churn_Risk_Category__c: string | null
  Health_Score__c: number | null
  Priority_Score__c: number | null
  Success_Level__c: string | null
  Current_Success_Level__c: string | null
  CurrentContractHasAutoRenewalClause__c: boolean | null
  Auto_Renewed_Last_Term__c: boolean | null
  Product__c: string | null
  Churn_Risks__c: string | null
  High_Value_Opp__c: boolean | null
  Handled_by_BU__c: boolean | null
  IsClosed: boolean | null
  Win_Type__c: string | null
  Type: string | null
  NextStep: string | null
  Description: string | null
  Gate_3_Violation_Date__c: string | null
}

export function mapSfOppToOpportunity(r: SfOppRecord): Opportunity {
  return {
    id: r.Id,
    name: r.Name,
    owner_name: r.Owner?.Name ?? null,
    owner_email: r.Owner?.Email ?? null,
    account: r.Account?.Name ?? null,
    stage: r.StageName,
    opp_status: r.Opportunity_Status__c,
    probable_outcome: r.Probable_Outcome__c,
    arr: r.ARR__c,
    current_arr: r.Current_ARR__c,
    arr_increase: r.ARR_Increase__c,
    offer_arr: r.Offer_ARR__c,
    renewal_date: r.Renewal_Date__c,
    close_date: r.CloseDate,
    created_date: r.CreatedDate,
    last_activity_date: r.LastActivityDate,
    last_modified_date: r.LastModifiedDate,
    next_follow_up_date: r.Next_Follow_Up_Date__c,
    churn_risk: r.AI_Churn_Risk_Category__c,
    health_score: r.Health_Score__c,
    priority_score: r.Priority_Score__c,
    success_level: r.Success_Level__c,
    current_success_level: r.Current_Success_Level__c,
    auto_renewal_clause: r.CurrentContractHasAutoRenewalClause__c,
    auto_renewed_last_term: r.Auto_Renewed_Last_Term__c,
    product: r.Product__c,
    churn_risks: r.Churn_Risks__c,
    high_value: r.High_Value_Opp__c,
    handled_by_bu: r.Handled_by_BU__c,
    is_closed: r.IsClosed,
    win_type: r.Win_Type__c,
    opp_type: r.Type,
    next_step: r.NextStep,
    description: r.Description,
    gate3_violation_date: r.Gate_3_Violation_Date__c,
    in_gate1: false,
    in_gate2: false,
    in_gate3: false,
    in_gate4: false,
    in_not_touched: false,
    in_past_due: false,
    updated_at: r.LastModifiedDate,
  }
}

// ---------------------------------------------------------------------------
// Pre-built SOQL queries matching config.json gate definitions
// ---------------------------------------------------------------------------

function dateWindow() {
  const today = new Date()
  const back = new Date(today)
  back.setMonth(back.getMonth() - 1)
  const fwd = new Date(today)
  fwd.setMonth(fwd.getMonth() + 6)
  return {
    from: back.toISOString().slice(0, 10),
    to: fwd.toISOString().slice(0, 10),
  }
}

export function mainOppSOQL(): string {
  const { from, to } = dateWindow()
  return `SELECT ${OPP_FIELDS} FROM Opportunity WHERE Owner.IsActive = true AND Owner.Name IN ${OPP_OWNERS} AND StageName NOT IN ('Closed Won', 'Closed Lost') AND Type != 'OEM' AND Renewal_Date__c >= ${from} AND Renewal_Date__c <= ${to} ORDER BY Priority_Score__c DESC NULLS LAST, Renewal_Date__c ASC`
}

export function gate1SOQL(): string {
  return `SELECT Id FROM Opportunity WHERE Owner.IsActive = true AND Owner.Name IN ${OPP_OWNERS} AND StageName IN ('Outreach', 'Pending') AND High_Value_Opp__c = false AND Handled_by_BU__c = false AND Type != 'OEM' AND Product__c NOT IN ('Contently', 'Khoros') AND (NOT Name LIKE '%_test_%') AND Renewal_Date__c >= TODAY AND Renewal_Date__c <= NEXT_N_DAYS:140 AND IsClosed = false`
}

export function gate2SOQL(): string {
  return `SELECT Id FROM Opportunity WHERE Owner.IsActive = true AND Owner.Name IN ${OPP_OWNERS} AND StageName IN ('Engaged', 'Outreach', 'Pending', 'Proposal') AND High_Value_Opp__c = false AND Handled_by_BU__c = false AND Product__c NOT IN ('Khoros', 'BroadVision') AND (NOT Name LIKE '%_test_%') AND Type = 'Renewal' AND Renewal_Date__c >= TODAY AND Renewal_Date__c <= NEXT_N_DAYS:89 AND IsClosed = false`
}

export function gate3SOQL(): string {
  return `SELECT Id FROM Opportunity WHERE Owner.IsActive = true AND Owner.Name IN ${OPP_OWNERS} AND Type = 'Renewal' AND Handled_by_BU__c = false AND StageName NOT IN ('Finalizing', 'Won\\'t Process') AND Renewal_Date__c >= TODAY AND Renewal_Date__c <= NEXT_N_DAYS:30 AND IsClosed = false AND (NOT Name LIKE '%_test_%')`
}

export function gate4SOQL(): string {
  return `SELECT Id FROM Opportunity WHERE Owner.IsActive = true AND Owner.Name IN ${OPP_OWNERS} AND RecordType.Name = 'Renewal' AND Type = 'Renewal' AND Handled_by_BU__c = false AND Product__c != 'CallStream/CityNumbers' AND (NOT Name LIKE '%_test_%') AND (NOT Name LIKE '%_invalid%') AND (NOT Name LIKE 'duplicate_%') AND Renewal_Date__c <= TODAY AND IsClosed = false`
}

export function notTouchedSOQL(): string {
  return `SELECT Id FROM Opportunity WHERE Owner.IsActive = true AND Owner.Name IN ${OPP_OWNERS} AND Type = 'Renewal' AND (NOT Account.Name LIKE '%_test_%') AND (LastModifiedDate < LAST_N_DAYS:7 OR LastActivityDate < LAST_N_DAYS:7 OR LastActivityDate = null) AND (Next_Follow_Up_Date__c < TODAY OR Next_Follow_Up_Date__c = null) AND Product__c NOT IN ('2 Hour Learning', 'CallStream/CityNumbers', 'Khoros') AND StageName != 'Pending' AND IsClosed = false AND Renewal_Date__c >= TODAY AND Renewal_Date__c <= NEXT_N_DAYS:90`
}

export function pastDueSOQL(): string {
  return `SELECT Id FROM Opportunity WHERE Owner.IsActive = true AND Owner.Name IN ${OPP_OWNERS} AND Type = 'Renewal' AND IsClosed = false AND (NOT Account.Name LIKE '%_test_%') AND Renewal_Date__c < TODAY AND Renewal_Date__c > 2025-01-01 AND Product__c NOT IN ('CallStream/CityNumbers', 'Playbooks', 'Khoros')`
}

export function activitiesSOQL(): string {
  return `SELECT Id, Subject, Status, CallDisposition, ActivityDate, Who.Name, What.Name, Owner.Name, Owner.Email, Description FROM Task WHERE Owner.IsActive = true AND Owner.Name IN ${OPP_OWNERS} AND Status = 'Completed' AND ActivityDate = LAST_N_DAYS:14 AND (CallDisposition LIKE '%completed%' OR CallDisposition LIKE '%attempted%' OR CallDisposition LIKE '%no show%') AND (Subject LIKE '%Feedback%' OR Subject LIKE '%Renewal Call%' OR Subject LIKE '%Cancellation%' OR Subject LIKE '%Platinum Upsell%' OR Subject LIKE '%Check-in Call%') ORDER BY ActivityDate DESC`
}

interface SfActivityRecord extends Record<string, unknown> {
  Id: string
  Subject: string | null
  Status: string | null
  CallDisposition: string | null
  ActivityDate: string | null
  Who: { Name: string | null } | null
  What: { Name: string | null } | null
  Owner: { Name: string | null; Email: string | null } | null
  Description: string | null
}

export function mapSfActivity(r: SfActivityRecord): Activity {
  return {
    id: r.Id,
    subject: r.Subject,
    status: r.Status,
    call_disposition: r.CallDisposition,
    activity_date: r.ActivityDate,
    who_name: r.Who?.Name ?? null,
    what_name: r.What?.Name ?? null,
    owner_name: r.Owner?.Name ?? null,
    owner_email: r.Owner?.Email ?? null,
    description: r.Description,
  }
}

/**
 * Fetch all pipeline data directly from Salesforce:
 * main opportunities, gate memberships, and call activities.
 */
export async function fetchPipelineFromSalesforce(): Promise<{
  opportunities: Opportunity[]
  activities: Activity[]
}> {
  const [mainRows, g1, g2, g3, g4, nt, pd, actRows] = await Promise.all([
    querySalesforce<SfOppRecord>(mainOppSOQL()),
    querySalesforce<{ Id: string }>(gate1SOQL()),
    querySalesforce<{ Id: string }>(gate2SOQL()),
    querySalesforce<{ Id: string }>(gate3SOQL()),
    querySalesforce<{ Id: string }>(gate4SOQL()),
    querySalesforce<{ Id: string }>(notTouchedSOQL()),
    querySalesforce<{ Id: string }>(pastDueSOQL()),
    querySalesforce<SfActivityRecord>(activitiesSOQL()),
  ])

  const g1Set = new Set(g1.map(r => r.Id))
  const g2Set = new Set(g2.map(r => r.Id))
  const g3Set = new Set(g3.map(r => r.Id))
  const g4Set = new Set(g4.map(r => r.Id))
  const ntSet = new Set(nt.map(r => r.Id))
  const pdSet = new Set(pd.map(r => r.Id))

  const opportunities = mainRows.map(r => {
    const opp = mapSfOppToOpportunity(r)
    opp.in_gate1 = g1Set.has(r.Id)
    opp.in_gate2 = g2Set.has(r.Id)
    opp.in_gate3 = g3Set.has(r.Id)
    opp.in_gate4 = g4Set.has(r.Id)
    opp.in_not_touched = ntSet.has(r.Id)
    opp.in_past_due = pdSet.has(r.Id)
    return opp
  })

  const activities = actRows.map(mapSfActivity)

  return { opportunities, activities }
}
