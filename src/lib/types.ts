export interface Opportunity {
  id: string
  name: string | null
  owner_name: string | null
  owner_email: string | null
  account: string | null
  stage: string | null
  opp_status: string | null
  probable_outcome: string | null
  arr: number | null
  current_arr: number | null
  arr_increase: number | null
  offer_arr: number | null
  renewal_date: string | null
  close_date: string | null
  created_date: string | null
  last_activity_date: string | null
  last_modified_date: string | null
  next_follow_up_date: string | null
  churn_risk: string | null
  health_score: number | null
  priority_score: number | null
  success_level: string | null
  current_success_level: string | null
  auto_renewal_clause: boolean | null
  auto_renewed_last_term: boolean | null
  product: string | null
  churn_risks: string | null
  high_value: boolean | null
  handled_by_bu: boolean | null
  is_closed: boolean | null
  win_type: string | null
  opp_type: string | null
  next_step: string | null
  description: string | null
  support_tickets_summary: string | null
  gate3_violation_date: string | null
  in_gate1: boolean
  in_gate2: boolean
  in_gate3: boolean
  in_gate4: boolean
  in_not_touched: boolean
  in_past_due: boolean
  updated_at: string | null
}

export interface Activity {
  id: string
  subject: string | null
  status: string | null
  call_disposition: string | null
  activity_date: string | null
  who_name: string | null
  what_name: string | null
  owner_name: string | null
  owner_email: string | null
  description: string | null
}

export interface LastRefresh {
  refreshed_at: string | null
  opp_count: number | null
  activity_count: number | null
}

export type TabId = 'gate1' | 'gate2' | 'gate3' | 'gate4' | 'not_touched' | 'past_due'
