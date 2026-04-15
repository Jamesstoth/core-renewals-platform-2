'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

interface RuleCondition {
  field: string
  operator: string
  value: string
}

interface SignalRule {
  id: string
  name: string
  conditions: RuleCondition[]
  priority: string
  is_active: boolean
  created_at: string
}

interface AutomationRule {
  id: string
  name: string
  signal_rule_id: string | null
  action_type: string
  action_config: Record<string, string>
  schedule: string
  is_active: boolean
  signal_rules?: { name: string } | null
}

interface EmailTemplate {
  id: string
  name: string
  subject_template: string
  body_template: string
  tone: string
  ai_instructions: string | null
  is_default: boolean
}

interface PlatformSettings {
  default_email_tone: string
  ai_reasoning_effort: string
  high_value_arr_threshold: number
  products_in_scope: string[]
}

type TabId = 'rules' | 'automations' | 'templates' | 'general'

// ── Constants ────────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'rules', label: 'Signal Rules', icon: '⚡' },
  { id: 'automations', label: 'Automations', icon: '⚙' },
  { id: 'templates', label: 'Email Templates', icon: '✉' },
  { id: 'general', label: 'General', icon: '☰' },
]

const CONDITION_FIELDS = [
  { value: 'stage', label: 'Stage' },
  { value: 'days_since_last_activity', label: 'Days Since Last Activity' },
  { value: 'days_until_renewal', label: 'Days Until Renewal' },
  { value: 'arr', label: 'ARR' },
  { value: 'owner', label: 'Owner' },
  { value: 'product_family', label: 'Product Family' },
  { value: 'gate_violation', label: 'Gate Violation' },
  { value: 'churn_risk', label: 'Churn Risk' },
  { value: 'has_open_activity', label: 'Has Open Activity' },
]

const OPERATORS = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'less_than', label: 'less than' },
  { value: 'within_days', label: 'within X days' },
  { value: 'contains', label: 'contains' },
]

const PRIORITIES = ['high', 'medium', 'low']

const ACTION_TYPES = [
  { value: 'draft_email', label: 'Draft Email' },
  { value: 'send_email', label: 'Send Email', caution: true },
  { value: 'create_sf_task', label: 'Create Salesforce Task' },
  { value: 'generate_call_objective', label: 'Generate Call Objective' },
  { value: 'slack_notification', label: 'Slack Notification', disabled: true },
]

const SCHEDULES = [
  { value: 'when_triggered', label: 'When triggered' },
  { value: 'daily_9am', label: 'Daily digest at 9 AM' },
  { value: 'daily_2pm', label: 'Daily digest at 2 PM' },
  { value: 'weekly_monday', label: 'Weekly on Monday' },
  { value: 'weekly_friday', label: 'Weekly on Friday' },
]

const TONES = ['professional', 'friendly', 'urgent', 'firm']

const TEMPLATE_VARS = [
  '{account_name}', '{contact_name}', '{rep_name}', '{product}',
  '{arr}', '{renewal_date}', '{days_until_renewal}',
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function priorityColor(p: string) {
  if (p === 'high') return '#dc2626'
  if (p === 'medium') return '#d97706'
  return '#64748b'
}

function toneColor(t: string) {
  if (t === 'urgent') return '#dc2626'
  if (t === 'firm') return '#d97706'
  if (t === 'friendly') return '#16a34a'
  return '#3b82f6'
}

async function api<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })
  return res.json()
}

// ── Signal Rules Tab ─────────────────────────────────────────────────────────

function SignalRulesTab() {
  const [rules, setRules] = useState<SignalRule[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<SignalRule | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await api<SignalRule[]>('/api/settings/signal-rules')
    setRules(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function startNew() {
    setIsNew(true)
    setEditing({
      id: '',
      name: '',
      conditions: [{ field: 'stage', operator: 'equals', value: '' }],
      priority: 'medium',
      is_active: true,
      created_at: '',
    })
  }

  async function save() {
    if (!editing) return
    const method = isNew ? 'POST' : 'PUT'
    await api('/api/settings/signal-rules', {
      method,
      body: JSON.stringify(editing),
    })
    setEditing(null)
    setIsNew(false)
    load()
  }

  async function remove(id: string) {
    await api('/api/settings/signal-rules', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
    })
    load()
  }

  async function toggle(rule: SignalRule) {
    await api('/api/settings/signal-rules', {
      method: 'PUT',
      body: JSON.stringify({ ...rule, is_active: !rule.is_active }),
    })
    load()
  }

  if (loading) return <div className="settings-loading">Loading signal rules...</div>

  if (editing) {
    return (
      <div className="settings-form">
        <div className="settings-form-header">
          <h3>{isNew ? 'New Signal Rule' : `Edit: ${editing.name}`}</h3>
          <button className="settings-btn-ghost" onClick={() => { setEditing(null); setIsNew(false) }}>Cancel</button>
        </div>

        <label className="settings-label">Rule Name</label>
        <input
          className="settings-input"
          value={editing.name}
          onChange={e => setEditing({ ...editing, name: e.target.value })}
          placeholder="e.g. High ARR No Activity"
        />

        <label className="settings-label">Priority</label>
        <div className="settings-priority-row">
          {PRIORITIES.map(p => (
            <button
              key={p}
              className={`settings-priority-btn ${editing.priority === p ? 'active' : ''}`}
              style={{ borderColor: editing.priority === p ? priorityColor(p) : undefined, color: editing.priority === p ? priorityColor(p) : undefined }}
              onClick={() => setEditing({ ...editing, priority: p })}
            >
              {p}
            </button>
          ))}
        </div>

        <label className="settings-label">Conditions <span style={{ color: 'var(--text-meta)', fontWeight: 400 }}>(AND logic — all must match)</span></label>
        {editing.conditions.map((c, i) => (
          <div key={i} className="settings-condition-row">
            <select
              className="settings-select"
              value={c.field}
              onChange={e => {
                const next = [...editing.conditions]
                next[i] = { ...next[i], field: e.target.value }
                setEditing({ ...editing, conditions: next })
              }}
            >
              {CONDITION_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <select
              className="settings-select"
              value={c.operator}
              onChange={e => {
                const next = [...editing.conditions]
                next[i] = { ...next[i], operator: e.target.value }
                setEditing({ ...editing, conditions: next })
              }}
            >
              {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              className="settings-input settings-condition-value"
              value={c.value}
              onChange={e => {
                const next = [...editing.conditions]
                next[i] = { ...next[i], value: e.target.value }
                setEditing({ ...editing, conditions: next })
              }}
              placeholder="Value"
            />
            {editing.conditions.length > 1 && (
              <button
                className="settings-btn-danger-sm"
                onClick={() => {
                  const next = editing.conditions.filter((_, j) => j !== i)
                  setEditing({ ...editing, conditions: next })
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <button
          className="settings-btn-ghost"
          onClick={() => setEditing({ ...editing, conditions: [...editing.conditions, { field: 'stage', operator: 'equals', value: '' }] })}
          style={{ alignSelf: 'flex-start', marginTop: 4 }}
        >
          + Add condition
        </button>

        <div className="settings-form-actions">
          <button className="settings-btn-primary" onClick={save} disabled={!editing.name.trim()}>
            {isNew ? 'Create Rule' : 'Save Changes'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="settings-section-header">
        <div>
          <h3>Signal Rules</h3>
          <p>Define conditions that flag opportunities for attention. Rules are evaluated against live Salesforce data.</p>
        </div>
        <button className="settings-btn-primary" onClick={startNew}>+ Add Rule</button>
      </div>

      {rules.length === 0 ? (
        <div className="settings-empty">No signal rules configured. Add one to get started.</div>
      ) : (
        <div className="settings-card-list">
          {rules.map(rule => (
            <div key={rule.id} className={`settings-card ${!rule.is_active ? 'inactive' : ''}`}>
              <div className="settings-card-top">
                <div className="settings-card-title-row">
                  <span className="settings-card-name">{rule.name}</span>
                  <span className="settings-badge" style={{ background: priorityColor(rule.priority) + '1a', color: priorityColor(rule.priority), borderColor: priorityColor(rule.priority) + '40' }}>
                    {rule.priority}
                  </span>
                </div>
                <div className="settings-card-actions">
                  <button className="settings-toggle" onClick={() => toggle(rule)}>
                    <span className={`settings-toggle-track ${rule.is_active ? 'on' : ''}`}>
                      <span className="settings-toggle-thumb" />
                    </span>
                  </button>
                  <button className="settings-btn-ghost-sm" onClick={() => { setEditing(rule); setIsNew(false) }}>Edit</button>
                  <button className="settings-btn-danger-sm" onClick={() => remove(rule.id)}>Delete</button>
                </div>
              </div>
              <div className="settings-conditions-preview">
                {rule.conditions.map((c, i) => (
                  <span key={i} className="settings-condition-pill">
                    {CONDITION_FIELDS.find(f => f.value === c.field)?.label ?? c.field}{' '}
                    <em>{OPERATORS.find(o => o.value === c.operator)?.label ?? c.operator}</em>{' '}
                    <strong>{c.value}</strong>
                    {i < rule.conditions.length - 1 && <span className="settings-and">AND</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── Automations Tab ──────────────────────────────────────────────────────────

function AutomationsTab() {
  const [automations, setAutomations] = useState<AutomationRule[]>([])
  const [signalRules, setSignalRules] = useState<SignalRule[]>([])
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AutomationRule | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [autos, rules, tmpls] = await Promise.all([
      api<AutomationRule[]>('/api/settings/automation-rules'),
      api<SignalRule[]>('/api/settings/signal-rules'),
      api<EmailTemplate[]>('/api/settings/email-templates'),
    ])
    setAutomations(Array.isArray(autos) ? autos : [])
    setSignalRules(Array.isArray(rules) ? rules : [])
    setTemplates(Array.isArray(tmpls) ? tmpls : [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function startNew() {
    setIsNew(true)
    setEditing({
      id: '',
      name: '',
      signal_rule_id: signalRules[0]?.id ?? null,
      action_type: 'draft_email',
      action_config: {},
      schedule: 'when_triggered',
      is_active: true,
    })
  }

  async function save() {
    if (!editing) return
    await api('/api/settings/automation-rules', {
      method: isNew ? 'POST' : 'PUT',
      body: JSON.stringify(editing),
    })
    setEditing(null)
    setIsNew(false)
    load()
  }

  async function remove(id: string) {
    await api('/api/settings/automation-rules', { method: 'DELETE', body: JSON.stringify({ id }) })
    load()
  }

  async function toggle(auto: AutomationRule) {
    await api('/api/settings/automation-rules', {
      method: 'PUT',
      body: JSON.stringify({ ...auto, is_active: !auto.is_active }),
    })
    load()
  }

  if (loading) return <div className="settings-loading">Loading automations...</div>

  if (editing) {
    const isEmail = editing.action_type === 'draft_email' || editing.action_type === 'send_email'
    const isSfTask = editing.action_type === 'create_sf_task'

    return (
      <div className="settings-form">
        <div className="settings-form-header">
          <h3>{isNew ? 'New Automation' : `Edit: ${editing.name}`}</h3>
          <button className="settings-btn-ghost" onClick={() => { setEditing(null); setIsNew(false) }}>Cancel</button>
        </div>

        <label className="settings-label">Automation Name</label>
        <input
          className="settings-input"
          value={editing.name}
          onChange={e => setEditing({ ...editing, name: e.target.value })}
          placeholder="e.g. Auto-draft chase email for stale quotes"
        />

        <label className="settings-label">Trigger — Signal Rule</label>
        <select
          className="settings-select"
          value={editing.signal_rule_id ?? ''}
          onChange={e => setEditing({ ...editing, signal_rule_id: e.target.value || null })}
        >
          <option value="">Select a signal rule...</option>
          {signalRules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>

        <label className="settings-label">Action Type</label>
        <select
          className="settings-select"
          value={editing.action_type}
          onChange={e => setEditing({ ...editing, action_type: e.target.value, action_config: {} })}
        >
          {ACTION_TYPES.map(a => (
            <option key={a.value} value={a.value} disabled={a.disabled}>
              {a.label}{a.caution ? ' ⚠ use with caution' : ''}{a.disabled ? ' (coming soon)' : ''}
            </option>
          ))}
        </select>

        {isEmail && (
          <>
            <label className="settings-label">Email Template</label>
            <select
              className="settings-select"
              value={editing.action_config.template_name ?? ''}
              onChange={e => setEditing({ ...editing, action_config: { ...editing.action_config, template_name: e.target.value } })}
            >
              <option value="">Select template...</option>
              {templates.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>

            <label className="settings-label">Recipient</label>
            <select
              className="settings-select"
              value={editing.action_config.recipient ?? ''}
              onChange={e => setEditing({ ...editing, action_config: { ...editing.action_config, recipient: e.target.value } })}
            >
              <option value="customer_contact">Customer Contact</option>
              <option value="rep">Rep (Owner)</option>
              <option value="vp">VP</option>
            </select>
          </>
        )}

        {isSfTask && (
          <>
            <label className="settings-label">Task Subject</label>
            <input
              className="settings-input"
              value={editing.action_config.subject ?? ''}
              onChange={e => setEditing({ ...editing, action_config: { ...editing.action_config, subject: e.target.value } })}
              placeholder="e.g. Follow up on renewal quote"
            />
            <label className="settings-label">Due Date Offset</label>
            <select
              className="settings-select"
              value={editing.action_config.due_offset ?? '2_days'}
              onChange={e => setEditing({ ...editing, action_config: { ...editing.action_config, due_offset: e.target.value } })}
            >
              <option value="1_day">1 day from trigger</option>
              <option value="2_days">2 days from trigger</option>
              <option value="3_days">3 days from trigger</option>
              <option value="1_week">1 week from trigger</option>
            </select>
          </>
        )}

        <label className="settings-label">Schedule</label>
        <select
          className="settings-select"
          value={editing.schedule}
          onChange={e => setEditing({ ...editing, schedule: e.target.value })}
        >
          {SCHEDULES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <div className="settings-form-actions">
          <button className="settings-btn-primary" onClick={save} disabled={!editing.name.trim()}>
            {isNew ? 'Create Automation' : 'Save Changes'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="settings-section-header">
        <div>
          <h3>Automations</h3>
          <p>Configure actions that run when signal rules fire. Execution engine coming in Phase 2.</p>
        </div>
        <button className="settings-btn-primary" onClick={startNew}>+ Add Automation</button>
      </div>

      {automations.length === 0 ? (
        <div className="settings-empty">No automations configured yet.</div>
      ) : (
        <div className="settings-card-list">
          {automations.map(auto => {
            const actionDef = ACTION_TYPES.find(a => a.value === auto.action_type)
            const scheduleDef = SCHEDULES.find(s => s.value === auto.schedule)
            return (
              <div key={auto.id} className={`settings-card ${!auto.is_active ? 'inactive' : ''}`}>
                <div className="settings-card-top">
                  <div className="settings-card-title-row">
                    <span className="settings-card-name">{auto.name}</span>
                  </div>
                  <div className="settings-card-actions">
                    <button className="settings-toggle" onClick={() => toggle(auto)}>
                      <span className={`settings-toggle-track ${auto.is_active ? 'on' : ''}`}>
                        <span className="settings-toggle-thumb" />
                      </span>
                    </button>
                    <button className="settings-btn-ghost-sm" onClick={() => { setEditing(auto); setIsNew(false) }}>Edit</button>
                    <button className="settings-btn-danger-sm" onClick={() => remove(auto.id)}>Delete</button>
                  </div>
                </div>
                <div className="settings-auto-meta">
                  <span className="settings-meta-item">
                    <span className="settings-meta-label">Trigger:</span>
                    {auto.signal_rules?.name ?? 'Not set'}
                  </span>
                  <span className="settings-meta-item">
                    <span className="settings-meta-label">Action:</span>
                    {actionDef?.label ?? auto.action_type}
                    {actionDef?.caution && <span style={{ color: '#d97706', marginLeft: 4 }}>⚠</span>}
                  </span>
                  <span className="settings-meta-item">
                    <span className="settings-meta-label">Schedule:</span>
                    {scheduleDef?.label ?? auto.schedule}
                  </span>
                  {auto.action_config.template_name && (
                    <span className="settings-meta-item">
                      <span className="settings-meta-label">Template:</span>
                      {auto.action_config.template_name}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ── Email Templates Tab ──────────────────────────────────────────────────────

function EmailTemplatesTab() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<EmailTemplate | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [testOutput, setTestOutput] = useState<string | null>(null)
  const [testLoading, setTestLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await api<EmailTemplate[]>('/api/settings/email-templates')
    setTemplates(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function startNew() {
    setIsNew(true)
    setEditing({
      id: '',
      name: '',
      subject_template: '',
      body_template: '',
      tone: 'professional',
      ai_instructions: null,
      is_default: false,
    })
  }

  async function save() {
    if (!editing) return
    await api('/api/settings/email-templates', {
      method: isNew ? 'POST' : 'PUT',
      body: JSON.stringify(editing),
    })
    setEditing(null)
    setIsNew(false)
    setTestOutput(null)
    load()
  }

  async function remove(id: string) {
    await api('/api/settings/email-templates', { method: 'DELETE', body: JSON.stringify({ id }) })
    load()
  }

  async function testGenerate() {
    if (!editing) return
    setTestLoading(true)
    setTestOutput(null)
    try {
      const sampleOpp = {
        accountName: 'Acme Corp',
        opportunityName: 'Acme Corp — Widget Pro Renewal 2025',
        owner: 'James Stothard',
        arr: 75000,
        product: 'Widget Pro',
        renewalDate: '2025-08-15',
        closeDate: '2025-08-15',
        stage: 'Proposal',
      }
      const subject = editing.subject_template
        .replace('{account_name}', sampleOpp.accountName)
        .replace('{product}', sampleOpp.product)
        .replace('{arr}', `$${sampleOpp.arr.toLocaleString()}`)
        .replace('{renewal_date}', sampleOpp.renewalDate)
        .replace('{rep_name}', sampleOpp.owner)
        .replace('{contact_name}', 'Sarah Chen')
        .replace('{days_until_renewal}', '122')

      const body = editing.body_template
        .replace(/{account_name}/g, sampleOpp.accountName)
        .replace(/{product}/g, sampleOpp.product)
        .replace(/{arr}/g, `$${sampleOpp.arr.toLocaleString()}`)
        .replace(/{renewal_date}/g, sampleOpp.renewalDate)
        .replace(/{rep_name}/g, sampleOpp.owner)
        .replace(/{contact_name}/g, 'Sarah Chen')
        .replace(/{days_until_renewal}/g, '122')

      setTestOutput(`Subject: ${subject}\n\n${body}`)
    } catch {
      setTestOutput('Error generating test output')
    } finally {
      setTestLoading(false)
    }
  }

  if (loading) return <div className="settings-loading">Loading email templates...</div>

  if (editing) {
    return (
      <div className="settings-form">
        <div className="settings-form-header">
          <h3>{isNew ? 'New Email Template' : `Edit: ${editing.name}`}</h3>
          <button className="settings-btn-ghost" onClick={() => { setEditing(null); setIsNew(false); setTestOutput(null) }}>Cancel</button>
        </div>

        <label className="settings-label">Template Name</label>
        <input
          className="settings-input"
          value={editing.name}
          onChange={e => setEditing({ ...editing, name: e.target.value })}
          placeholder="e.g. Chase Quote Signature"
        />

        <label className="settings-label">Tone</label>
        <div className="settings-tone-row">
          {TONES.map(t => (
            <button
              key={t}
              className={`settings-tone-btn ${editing.tone === t ? 'active' : ''}`}
              style={{ borderColor: editing.tone === t ? toneColor(t) : undefined, color: editing.tone === t ? toneColor(t) : undefined }}
              onClick={() => setEditing({ ...editing, tone: t })}
            >
              {t}
            </button>
          ))}
        </div>

        <label className="settings-label">
          Subject Line
          <span className="settings-var-hint">Variables: {TEMPLATE_VARS.join(' ')}</span>
        </label>
        <input
          className="settings-input"
          value={editing.subject_template}
          onChange={e => setEditing({ ...editing, subject_template: e.target.value })}
          placeholder="e.g. Following up: {product} renewal for {account_name}"
        />

        <label className="settings-label">Body Template</label>
        <textarea
          className="settings-textarea"
          value={editing.body_template}
          onChange={e => setEditing({ ...editing, body_template: e.target.value })}
          placeholder="Write the email body. Use variables like {contact_name}, {product}, etc."
          rows={10}
        />

        <label className="settings-label">Custom AI Instructions <span style={{ color: 'var(--text-meta)', fontWeight: 400 }}>(optional)</span></label>
        <textarea
          className="settings-textarea"
          value={editing.ai_instructions ?? ''}
          onChange={e => setEditing({ ...editing, ai_instructions: e.target.value || null })}
          placeholder="e.g. Emphasise value of Platinum support, reference the 25% standard increase as industry-aligned"
          rows={3}
        />

        <div className="settings-form-actions">
          <button className="settings-btn-secondary" onClick={testGenerate} disabled={testLoading}>
            {testLoading ? 'Generating...' : 'Test Generate'}
          </button>
          <button className="settings-btn-primary" onClick={save} disabled={!editing.name.trim()}>
            {isNew ? 'Create Template' : 'Save Changes'}
          </button>
        </div>

        {testOutput && (
          <div className="settings-test-output">
            <label className="settings-label">Test Output <span style={{ color: 'var(--text-meta)', fontWeight: 400 }}>(sample data: Acme Corp / Sarah Chen / Widget Pro)</span></label>
            <pre>{testOutput}</pre>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="settings-section-header">
        <div>
          <h3>Email Templates</h3>
          <p>Manage templates used by AI email generation. Variables are replaced with live opportunity data.</p>
        </div>
        <button className="settings-btn-primary" onClick={startNew}>+ Add Template</button>
      </div>

      {templates.length === 0 ? (
        <div className="settings-empty">No email templates. Add one to get started.</div>
      ) : (
        <div className="settings-card-list">
          {templates.map(tmpl => (
            <div key={tmpl.id} className="settings-card">
              <div className="settings-card-top">
                <div className="settings-card-title-row">
                  <span className="settings-card-name">{tmpl.name}</span>
                  <span className="settings-badge" style={{ background: toneColor(tmpl.tone) + '1a', color: toneColor(tmpl.tone), borderColor: toneColor(tmpl.tone) + '40' }}>
                    {tmpl.tone}
                  </span>
                  {tmpl.is_default && <span className="settings-badge-default">default</span>}
                </div>
                <div className="settings-card-actions">
                  <button className="settings-btn-ghost-sm" onClick={() => { setEditing(tmpl); setIsNew(false) }}>Edit</button>
                  {!tmpl.is_default && <button className="settings-btn-danger-sm" onClick={() => remove(tmpl.id)}>Delete</button>}
                </div>
              </div>
              <div className="settings-template-preview">
                <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>Subject:</span>{' '}
                <span style={{ color: 'var(--text-td)' }}>{tmpl.subject_template || '(empty)'}</span>
              </div>
              {tmpl.ai_instructions && (
                <div className="settings-ai-hint">
                  AI: {tmpl.ai_instructions}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── General Tab ──────────────────────────────────────────────────────────────

function GeneralTab() {
  const [settings, setSettings] = useState<PlatformSettings>({
    default_email_tone: 'professional',
    ai_reasoning_effort: 'standard',
    high_value_arr_threshold: 100000,
    products_in_scope: [],
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const data = await api<Record<string, unknown>>('/api/settings/platform-settings')
      if (data && !('error' in data)) {
        setSettings({
          default_email_tone: (data.default_email_tone as string) ?? 'professional',
          ai_reasoning_effort: (data.ai_reasoning_effort as string) ?? 'standard',
          high_value_arr_threshold: (data.high_value_arr_threshold as number) ?? 100000,
          products_in_scope: (data.products_in_scope as string[]) ?? [],
        })
      }
      setLoading(false)
    }
    load()
  }, [])

  async function save() {
    setSaving(true)
    await api('/api/settings/platform-settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return <div className="settings-loading">Loading settings...</div>

  return (
    <>
      <div className="settings-section-header">
        <div>
          <h3>General Settings</h3>
          <p>Platform-wide defaults and preferences.</p>
        </div>
      </div>

      <div className="settings-general-grid">
        <div className="settings-general-card">
          <label className="settings-label">Default Email Tone</label>
          <p className="settings-hint">Applied when no template-specific tone is set.</p>
          <div className="settings-tone-row">
            {TONES.map(t => (
              <button
                key={t}
                className={`settings-tone-btn ${settings.default_email_tone === t ? 'active' : ''}`}
                style={{ borderColor: settings.default_email_tone === t ? toneColor(t) : undefined, color: settings.default_email_tone === t ? toneColor(t) : undefined }}
                onClick={() => setSettings({ ...settings, default_email_tone: t })}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-general-card">
          <label className="settings-label">AI Reasoning Effort</label>
          <p className="settings-hint">Higher effort = better quality but slower responses.</p>
          <div className="settings-tone-row">
            {['standard', 'high'].map(e => (
              <button
                key={e}
                className={`settings-tone-btn ${settings.ai_reasoning_effort === e ? 'active' : ''}`}
                style={{ borderColor: settings.ai_reasoning_effort === e ? '#3b82f6' : undefined, color: settings.ai_reasoning_effort === e ? '#3b82f6' : undefined }}
                onClick={() => setSettings({ ...settings, ai_reasoning_effort: e })}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-general-card">
          <label className="settings-label">High-Value ARR Threshold</label>
          <p className="settings-hint">Opportunities above this are treated as HVO. Default $100K per business rules.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>$</span>
            <input
              className="settings-input"
              type="number"
              value={settings.high_value_arr_threshold}
              onChange={e => setSettings({ ...settings, high_value_arr_threshold: Number(e.target.value) })}
              style={{ maxWidth: 160 }}
            />
          </div>
        </div>

        <div className="settings-general-card">
          <label className="settings-label">Notification Preferences</label>
          <p className="settings-hint">Email and Slack notification settings. Coming soon.</p>
          <div className="settings-coming-soon">Coming in Phase 2</div>
        </div>
      </div>

      <div className="settings-form-actions" style={{ marginTop: 16 }}>
        <button className="settings-btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save Settings'}
        </button>
      </div>
    </>
  )
}

// ── Main Settings Page ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>('rules')

  return (
    <div>
      <header className="page-header">
        <Link href="/pipeline" className="brand" style={{ textDecoration: 'none' }}>ISR Dashboard</Link>
        <span className="header-meta" />
        <div className="view-toggle">
          <Link href="/pipeline" className="view-toggle-btn" style={{ textDecoration: 'none' }}>Pipeline</Link>
          <Link href="/pipeline" className="view-toggle-btn" style={{ textDecoration: 'none' }}>Accountability</Link>
          <Link href="/pipeline" className="view-toggle-btn" style={{ textDecoration: 'none' }}>Signals</Link>
          <span className="view-toggle-btn active">Settings</span>
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-sidebar">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`settings-nav-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="settings-nav-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        <main className="settings-main">
          {tab === 'rules' && <SignalRulesTab />}
          {tab === 'automations' && <AutomationsTab />}
          {tab === 'templates' && <EmailTemplatesTab />}
          {tab === 'general' && <GeneralTab />}
        </main>
      </div>
    </div>
  )
}
