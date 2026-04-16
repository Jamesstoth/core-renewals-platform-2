export enum QueueStatus {
  OverdueFollowUp = "overdue_follow_up",
  NeedsFollowUpThisWeek = "needs_follow_up_this_week",
  RecentlyContacted = "recently_contacted",
  WaitingOnCustomer = "waiting_on_customer",
  WaitingOnInternalAction = "waiting_on_internal_action",
  NoActionNeeded = "no_action_needed",
  NeedsRepReview = "needs_rep_review",
}

// --- Filter & sort types ---

export type SortField = "closeDate" | "arr" | "daysOverdue" | "lastActivityDate";
export type SortDirection = "asc" | "desc";

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export type CloseDateRange = "this_month" | "next_30" | "next_60" | "next_90" | "custom";
export type ArrRange = "under_50k" | "50k_200k" | "200k_500k" | "over_500k";
export type HealthScoreBucket = "at_risk" | "needs_attention" | "healthy";

export interface FilterState {
  owners: string[];
  followUpStatuses: QueueStatus[];
  renewalCallLogged: "all" | "yes" | "no";
  closeDateRange: CloseDateRange | null;
  closeDateCustomStart: string | null;
  closeDateCustomEnd: string | null;
  productFamilies: string[];
  stages: string[];
  arrRanges: ArrRange[];
  healthScores: HealthScoreBucket[];
  churnRiskCategories: string[];
}

export interface FilterOptions {
  owners: string[];
  stages: string[];
  productFamilies: string[];
  churnRiskCategories: string[];
}

// --- Portal data types ---

export interface Opportunity {
  id: string;
  accountName: string;
  opportunityName: string;
  owner: string;
  stage: string;
  renewalDate: string;
  closeDate: string;
  arr: number;
  amount: number;
  queueStatus: QueueStatus;
  daysSinceLastRenewalCall: number;
  flagReason: string;
  lastContactDate: string;
  nextStepOwner: string;
  productFamily: string | null;
  healthScore: number | null;
  churnRiskCategory: string | null;
  renewalCallLogged: boolean;
  hasOpenActivity: boolean;
  hasOverdueTask: boolean;
  description: string | null;
  accountReport: string | null;
  opportunityReport: string | null;
  supportTicketsSummary: string | null;
}

export interface ActivityEntry {
  id: string;
  date: string;
  type: "Call" | "Email" | "Meeting" | "Internal Note";
  subject: string;
  performedBy: string;
  notes: string;
}

export interface AiSuggestions {
  emailDraft: {
    subject: string;
    body: string;
  };
  callObjective: string;
}

export interface QueueItem {
  opportunity: Opportunity;
  activityHistory: ActivityEntry[];
  aiSuggestions: AiSuggestions;
}

export interface MetricCard {
  label: string;
  value: number;
  color: string;
  description: string;
  format?: "count" | "currency";
}

// --- Salesforce record shapes (from sf_describe_object) ---

interface SfNameRef {
  Name: string;
  attributes?: { type: string; url: string };
}

/**
 * Account relationship shape when traversed from Opportunity.
 * `Account_Report__c` and `Support_Tickets_Summary__c` live on Account,
 * not Opportunity, so SOQL must select them as `Account.<field>` and
 * consumers read them nested.
 */
export interface SfAccountRef extends SfNameRef {
  Account_Report__c: string | null;
  Support_Tickets_Summary__c: string | null;
}

export interface SfOpportunityRecord {
  Id: string;
  Name: string;
  AccountId: string;
  Account: SfAccountRef | null;
  OwnerId: string;
  Owner: SfNameRef | null;
  StageName: string;
  Renewal_Date__c: string | null;
  CloseDate: string;
  ARR__c: number | null;
  Amount: number | null;
  LastActivityDate: string | null;
  Next_Follow_Up_Date__c: string | null;
  NextStep: string | null;
  IsClosed: boolean;
  IsWon: boolean;
  HasOpenActivity: boolean;
  HasOverdueTask: boolean;
  Health_Score__c: number | null;
  AI_Churn_Risk_Category__c: string | null;
  Priority_Score__c: number | null;
  Product__c: string | null;
  Opportunity_Report__c: string | null;
}

export interface SfTaskRecord {
  Id: string;
  Subject: string | null;
  Status: string;
  Type: string | null;
  TaskSubtype: string | null;
  ActivityDate: string | null;
  CompletedDateTime: string | null;
  Description: string | null;
  Owner: SfNameRef | null;
  WhatId: string;
  Is_Renewal_Call__c: boolean;
  Work_Unit_Type__c: string | null;
  CallType: string | null;
  CallDurationInSeconds: number | null;
}

export interface RulesEngineResult {
  queueStatus: QueueStatus;
  flagReason: string;
  daysSinceLastRenewalCall: number | null;
  lastContactDate: string | null;
}
