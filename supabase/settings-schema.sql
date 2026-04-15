-- Settings Schema for Core Renewals Platform
-- Run this in the Supabase SQL editor to create the settings tables.
-- These store platform configuration (rules, templates, preferences),
-- NOT CRM data (which comes live from Salesforce).

-- ── Signal Rules ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signal_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  conditions  JSONB NOT NULL,
  priority    TEXT DEFAULT 'medium',
  is_active   BOOLEAN DEFAULT true,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Automation Rules ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  signal_rule_id  UUID REFERENCES signal_rules(id) ON DELETE SET NULL,
  action_type     TEXT NOT NULL,
  action_config   JSONB NOT NULL,
  schedule        TEXT DEFAULT 'when_triggered',
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ── Email Templates ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  subject_template TEXT,
  body_template    TEXT,
  tone             TEXT DEFAULT 'professional',
  ai_instructions  TEXT,
  is_default       BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ── Platform Settings (key-value) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_settings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT UNIQUE NOT NULL,
  value      JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Row Level Security ─────────────────────────────────────────────────────
-- Auth is currently bypassed so we allow anon read/write on all 4 tables.

ALTER TABLE signal_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_signal_rules"      ON signal_rules      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_automation_rules"  ON automation_rules  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_email_templates"   ON email_templates   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_platform_settings" ON platform_settings FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_signal_rules"      ON signal_rules      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_automation_rules"  ON automation_rules  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_email_templates"   ON email_templates   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_platform_settings" ON platform_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_signal_rules_active      ON signal_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_automation_rules_active  ON automation_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_automation_rules_signal  ON automation_rules(signal_rule_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_default  ON email_templates(is_default) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_platform_settings_key    ON platform_settings(key);

-- ── Seed: Default Signal Rules ─────────────────────────────────────────────
INSERT INTO signal_rules (name, conditions, priority, is_active) VALUES
(
  'Quote Follow-Up Stale 7+ Days',
  '[{"field":"stage","operator":"equals","value":"Quote Follow-Up"},{"field":"days_since_last_activity","operator":"greater_than","value":"7"}]'::jsonb,
  'high',
  true
),
(
  'High ARR At Risk',
  '[{"field":"arr","operator":"greater_than","value":"50000"},{"field":"days_until_renewal","operator":"less_than","value":"60"},{"field":"days_since_last_activity","operator":"greater_than","value":"14"}]'::jsonb,
  'high',
  true
),
(
  'Gate 3 No Action',
  '[{"field":"gate_violation","operator":"equals","value":"gate3"},{"field":"days_since_last_activity","operator":"greater_than","value":"5"}]'::jsonb,
  'medium',
  true
),
(
  'Renewal Call Overdue',
  '[{"field":"days_until_renewal","operator":"less_than","value":"90"},{"field":"stage","operator":"not_equals","value":"Finalizing"},{"field":"days_since_last_activity","operator":"greater_than","value":"21"}]'::jsonb,
  'medium',
  true
);

-- ── Seed: Default Email Templates ──────────────────────────────────────────
INSERT INTO email_templates (name, subject_template, body_template, tone, is_default) VALUES
(
  'Chase Quote Signature',
  'Following up: {product} renewal for {account_name}',
  'Hi {contact_name},\n\nI wanted to follow up on the renewal quote we sent through for {product}. Your renewal date of {renewal_date} is approaching and I want to make sure we have everything finalised in time.\n\nCould you let me know if you have any questions about the quote, or if there''s anything I can help clarify?\n\nBest regards,\n{rep_name}',
  'professional',
  true
),
(
  'Follow-up After Renewal Call',
  'Great speaking with you — {product} renewal next steps',
  'Hi {contact_name},\n\nThank you for taking the time to speak with me today about your {product} renewal.\n\nAs discussed, here''s a summary of the next steps:\n\n[AI: Insert call summary and action items]\n\nPlease don''t hesitate to reach out if you have any questions.\n\nBest regards,\n{rep_name}',
  'friendly',
  true
),
(
  'Initial Outreach',
  '{product} renewal — let''s connect',
  'Hi {contact_name},\n\nI''m reaching out regarding your upcoming {product} renewal on {renewal_date}.\n\nI''d love to schedule a brief call to discuss your experience, answer any questions, and ensure a smooth renewal process. Would any time this week or next work for a quick chat?\n\nBest regards,\n{rep_name}',
  'professional',
  true
),
(
  'AR Warning',
  'Important: {product} auto-renewal approaching — {renewal_date}',
  'Hi {contact_name},\n\nThis is a courtesy reminder that your {product} subscription is set to auto-renew on {renewal_date}.\n\nThe auto-renewal will process at the standard list price. If you''d like to discuss renewal options, including a personalised offer, please get in touch before {renewal_date}.\n\nBest regards,\n{rep_name}',
  'firm',
  true
),
(
  'Escalation to VP',
  'Escalation: {account_name} — {product} renewal at risk ({arr} ARR)',
  'Hi,\n\nI''m escalating the {product} renewal for {account_name} ({arr} ARR, renewing {renewal_date}).\n\n[AI: Insert risk summary, customer objections, and recommended approach]\n\nRequesting guidance on next steps.\n\nThanks,\n{rep_name}',
  'professional',
  true
),
(
  'Re-engagement After Silence',
  'Checking in — {product} renewal for {account_name}',
  'Hi {contact_name},\n\nI hope you''re well. I haven''t heard back in a while and wanted to check in regarding your {product} renewal (due {renewal_date}).\n\nI understand things get busy — would it help to schedule a quick 15-minute call at a time that works for you? I''m happy to work around your schedule.\n\nBest regards,\n{rep_name}',
  'friendly',
  true
),
(
  'Extension Request',
  'Extension request: {account_name} — {product} renewal',
  'Hi {contact_name},\n\nThank you for your continued partnership. I understand you''ve requested additional time to finalise the {product} renewal.\n\n[AI: Insert extension terms and conditions]\n\nPlease confirm at your earliest convenience so we can process this.\n\nBest regards,\n{rep_name}',
  'professional',
  true
);

-- ── Seed: Default Automation ───────────────────────────────────────────────
INSERT INTO automation_rules (name, signal_rule_id, action_type, action_config, schedule, is_active)
SELECT
  'Auto-draft chase email for stale quotes',
  sr.id,
  'draft_email',
  '{"template_name":"Chase Quote Signature","recipient":"customer_contact"}'::jsonb,
  'when_triggered',
  true
FROM signal_rules sr WHERE sr.name = 'Quote Follow-Up Stale 7+ Days'
LIMIT 1;

-- ── Seed: Default Platform Settings ────────────────────────────────────────
INSERT INTO platform_settings (key, value) VALUES
  ('default_email_tone', '"professional"'::jsonb),
  ('ai_reasoning_effort', '"standard"'::jsonb),
  ('high_value_arr_threshold', '100000'::jsonb),
  ('products_in_scope', '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;
