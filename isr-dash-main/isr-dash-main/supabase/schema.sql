-- Trilogy Renewals Dashboard — Supabase Schema
-- Run this in the Supabase SQL editor to create the schema.

-- ── Opportunities ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opportunities (
  id                      TEXT PRIMARY KEY,
  name                    TEXT,
  owner_name              TEXT,
  owner_email             TEXT,
  account                 TEXT,
  stage                   TEXT,
  opp_status              TEXT,
  probable_outcome        TEXT,
  arr                     NUMERIC,
  current_arr             NUMERIC,
  arr_increase            NUMERIC,
  offer_arr               NUMERIC,
  renewal_date            DATE,
  close_date              DATE,
  created_date            DATE,
  last_activity_date      DATE,
  last_modified_date      DATE,
  next_follow_up_date     DATE,
  churn_risk              TEXT,
  health_score            NUMERIC,
  priority_score          NUMERIC,
  success_level           TEXT,
  current_success_level   TEXT,
  auto_renewal_clause     BOOLEAN,
  auto_renewed_last_term  BOOLEAN,
  product                 TEXT,
  churn_risks             TEXT,
  high_value              BOOLEAN,
  handled_by_bu           BOOLEAN,
  is_closed               BOOLEAN,
  win_type                TEXT,
  opp_type                TEXT,
  next_step               TEXT,
  description             TEXT,
  gate3_violation_date    DATE,

  -- Gate membership flags (set by write_to_supabase.py on each refresh)
  in_gate1                BOOLEAN DEFAULT FALSE,
  in_gate2                BOOLEAN DEFAULT FALSE,
  in_gate3                BOOLEAN DEFAULT FALSE,
  in_gate4                BOOLEAN DEFAULT FALSE,
  in_not_touched          BOOLEAN DEFAULT FALSE,
  in_past_due             BOOLEAN DEFAULT FALSE,

  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ── Activities (calls/tasks) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id              TEXT PRIMARY KEY,
  subject         TEXT,
  status          TEXT,
  call_disposition TEXT,
  activity_date   DATE,
  who_name        TEXT,
  what_name       TEXT,
  owner_name      TEXT,
  owner_email     TEXT,
  description     TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Pipeline Dashboard HTML Cache ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_html (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  html        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Last Refresh Metadata ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS last_refresh (
  id              INTEGER PRIMARY KEY DEFAULT 1,
  refreshed_at    TIMESTAMPTZ DEFAULT NOW(),
  opp_count       INTEGER,
  activity_count  INTEGER
);

INSERT INTO last_refresh (id, refreshed_at, opp_count, activity_count)
VALUES (1, NOW(), 0, 0)
ON CONFLICT (id) DO NOTHING;

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE opportunities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE last_refresh   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_html  ENABLE ROW LEVEL SECURITY;

-- Authenticated users (logged-in via Google OAuth) can read all rows
CREATE POLICY "authenticated_read_opportunities"
  ON opportunities FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_read_activities"
  ON activities FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_read_last_refresh"
  ON last_refresh FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_read_pipeline_html"
  ON pipeline_html FOR SELECT
  TO authenticated
  USING (true);

-- Service role (used by GH Actions write_to_supabase.py) can write
-- No explicit policy needed — service role bypasses RLS by default.

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_opps_owner       ON opportunities(owner_email);
CREATE INDEX IF NOT EXISTS idx_opps_renewal     ON opportunities(renewal_date);
CREATE INDEX IF NOT EXISTS idx_opps_gate1       ON opportunities(in_gate1) WHERE in_gate1 = TRUE;
CREATE INDEX IF NOT EXISTS idx_opps_gate2       ON opportunities(in_gate2) WHERE in_gate2 = TRUE;
CREATE INDEX IF NOT EXISTS idx_opps_gate3       ON opportunities(in_gate3) WHERE in_gate3 = TRUE;
CREATE INDEX IF NOT EXISTS idx_opps_gate4       ON opportunities(in_gate4) WHERE in_gate4 = TRUE;
CREATE INDEX IF NOT EXISTS idx_opps_not_touched ON opportunities(in_not_touched) WHERE in_not_touched = TRUE;
CREATE INDEX IF NOT EXISTS idx_opps_past_due    ON opportunities(in_past_due)    WHERE in_past_due = TRUE;
CREATE INDEX IF NOT EXISTS idx_acts_owner       ON activities(owner_email);
CREATE INDEX IF NOT EXISTS idx_acts_date        ON activities(activity_date);
