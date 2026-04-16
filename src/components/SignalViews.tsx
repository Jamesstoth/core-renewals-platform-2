'use client'

/**
 * Signal views — React view components rendered inside the /pipeline
 * Dashboard, driven by the same live `Opportunity[]` that powers the gate
 * tables.
 *
 *   WorkflowSignalsView  — boolean trigger matrix (12 columns per opp)
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import type { Opportunity } from '@/lib/types'
import type { QueueItem } from '@/types/renewals'
import ExpandedDetails from './ExpandedDetails'

// ── shared helpers ───────────────────────────────────────────────────────────

const SF_BASE = 'https://trilogy-sales.lightning.force.com/lightning/r/Opportunity'

function fmtARR(v: number | null | undefined) {
  if (v == null) return '—'
  const n = Math.abs(v)
  if (n >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function daysBetween(later: string | null | undefined, earlier: Date) {
  if (!later) return null
  return Math.round((new Date(later).getTime() - earlier.getTime()) / 86_400_000)
}

function daysSince(dateStr: string | null | undefined, now: Date) {
  if (!dateStr) return null
  return Math.round((now.getTime() - new Date(dateStr).getTime()) / 86_400_000)
}

function oppLink(id: string, name: string | null) {
  return <a href={`${SF_BASE}/${id}/view`} target="_blank" rel="noreferrer">{name ?? id}</a>
}


// ═══════════════════════════════════════════════════════════════════════════
// Workflow Signals view — boolean trigger matrix
// ═══════════════════════════════════════════════════════════════════════════

interface Signals {
  gap14:             boolean
  gap30:             boolean
  followUp:          boolean
  churnHigh:         boolean
  churnMedium:       boolean
  imminent:          boolean  // DTR <= 30
  window:            boolean  // DTR 30..60
  hvoRisk:           boolean
  silentChurn:       boolean
  gate1:             boolean
  gate2:             boolean
  gate3:             boolean
  gate4:             boolean
  pastDue:           boolean
  openSupportTickets: boolean
}

/**
 * Detect any open support tickets from the free-text
 * `Account.Support_Tickets_Summary__c` field. Heuristic — the summary is
 * AI-generated and unstructured, so we look for the common phrasings and
 * explicitly skip "no open" / "0 open" to avoid false positives.
 */
function hasOpenSupportTickets(text: string | null | undefined): boolean {
  if (!text) return false
  const t = text.toLowerCase()

  // Explicit "none" phrasing — rule out first
  if (/\b(?:no|zero|0)\s+(?:open|unresolved|pending|active)\b/.test(t)) return false
  if (/\bno\s+(?:support\s+)?tickets?\b/.test(t)) return false

  // "N open ..." / "N unresolved ..." / "N pending ..." — N > 0
  const m = /(\d+)\s*(?:open|unresolved|pending|active)\b/.exec(t)
  if (m && parseInt(m[1], 10) > 0) return true

  // "P1: N" / "P2 count: N" — N > 0
  const pm = /\bp(?:riority\s*)?[1-4]\s*[:=]?\s*(\d+)/.exec(t)
  if (pm && parseInt(pm[1], 10) > 0) return true

  // Fallback — generic open/unresolved phrasing
  if (/\b(?:open|unresolved|pending|active)\s+(?:ticket|case|issue|escalation|p[1-4])/.test(t)) return true

  return false
}

const SIGNAL_COLS: { key: keyof Signals; label: string; color: string }[] = [
  { key: 'imminent',    label: 'Renewal ≤30d',   color: '#dc2626' },
  { key: 'window',      label: 'Window 30–60d',  color: '#d97706' },
  { key: 'pastDue',     label: 'Past Due',       color: '#dc2626' },
  { key: 'gate1',       label: 'Gate 1',         color: '#ef4444' },
  { key: 'gate2',       label: 'Gate 2',         color: '#f97316' },
  { key: 'gate3',       label: 'Gate 3',         color: '#eab308' },
  { key: 'gate4',       label: 'Gate 4',         color: '#dc2626' },
  { key: 'gap14',       label: 'Gap >14d',       color: '#d97706' },
  { key: 'gap30',       label: 'Gap >30d',       color: '#dc2626' },
  { key: 'followUp',    label: 'Follow-up Late', color: '#d97706' },
  { key: 'churnHigh',   label: 'Churn High',     color: '#dc2626' },
  { key: 'churnMedium', label: 'Churn Med',      color: '#d97706' },
  { key: 'hvoRisk',     label: 'HVO at Risk',    color: '#7c3aed' },
  { key: 'silentChurn', label: 'Silent Churn',   color: '#be123c' },
  { key: 'openSupportTickets', label: 'Open Support Tickets', color: '#0891b2' },
]

function computeSignals(o: Opportunity, now: Date): Signals {
  const dtr  = daysBetween(o.renewal_date, now) ?? 9999
  const gap  = daysSince(o.last_activity_date, now) ?? 9999
  const fu   = o.next_follow_up_date ? daysBetween(o.next_follow_up_date, now) ?? 0 : 0
  const risk = (o.churn_risk ?? '').toLowerCase()
  const gap14 = gap > 14
  const gap30 = gap > 30
  const churnHigh   = risk === 'high'
  const churnMedium = risk === 'medium'
  const imminent    = dtr >= 0 && dtr <= 30
  const pastDue     = !!o.in_past_due || dtr < 0
  const hvoRisk     = !!o.high_value && (o.in_gate1 || o.in_gate3 || o.in_gate4 || pastDue)
  const silentChurn = churnHigh && !!o.in_not_touched
  return {
    gap14, gap30,
    followUp: fu < 0,
    churnHigh, churnMedium,
    imminent,
    window: dtr > 30 && dtr <= 60,
    hvoRisk,
    silentChurn,
    gate1: !!o.in_gate1,
    gate2: !!o.in_gate2,
    gate3: !!o.in_gate3,
    gate4: !!o.in_gate4,
    pastDue,
    openSupportTickets: hasOpenSupportTickets(o.support_tickets_summary),
  }
}

function signalCount(s: Signals): number {
  return Object.values(s).filter(Boolean).length
}

export function WorkflowSignalsView({ opportunities }: { opportunities: Opportunity[] }) {
  const now = useMemo(() => new Date(), [])
  const [minSignals, setMinSignals] = useState(1)
  const [ownerFilter, setOwnerFilter] = useState('')
  const [search, setSearch] = useState('')
  const [focusKey, setFocusKey] = useState<keyof Signals | ''>('')

  // Inline drilldown — mirrors the Signals page card expansion. Clicking
  // a signal dot expands a row below with the same ExpandedDetails view
  // (AI overview, call objective, email drafts) plus a trigger_label
  // banner showing which signal fired.
  const [drill, setDrill] = useState<{ oppId: string; label: string } | null>(null)
  const [queueItems, setQueueItems] = useState<QueueItem[] | null>(null)
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)

  // Lazy-load the rich QueueItem dataset the first time a dot is clicked.
  useEffect(() => {
    if (!drill || queueItems || queueLoading) return
    setQueueLoading(true)
    setQueueError(null)
    fetch('/api/opportunities')
      .then(r => r.json())
      .then(d => setQueueItems(d.items ?? []))
      .catch(e => setQueueError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setQueueLoading(false))
  }, [drill, queueItems, queueLoading])

  const rows = useMemo(() =>
    opportunities.map(o => {
      const sig   = computeSignals(o, now)
      const count = signalCount(sig)
      return { opp: o, sig, count }
    }),
  [opportunities, now])

  const totals = useMemo(() => {
    const t: Record<keyof Signals, number> = {
      gap14: 0, gap30: 0, followUp: 0, churnHigh: 0, churnMedium: 0,
      imminent: 0, window: 0, hvoRisk: 0, silentChurn: 0,
      gate1: 0, gate2: 0, gate3: 0, gate4: 0, pastDue: 0,
      openSupportTickets: 0,
    }
    for (const r of rows) {
      for (const k of Object.keys(t) as (keyof Signals)[]) {
        if (r.sig[k]) t[k] += 1
      }
    }
    return t
  }, [rows])

  const owners = useMemo(() =>
    Array.from(new Set(opportunities.map(o => o.owner_name).filter(Boolean) as string[])).sort(),
  [opportunities])

  const filtered = useMemo(() => rows.filter(r => {
    if (r.count < minSignals) return false
    if (focusKey && !r.sig[focusKey]) return false
    if (ownerFilter && r.opp.owner_name !== ownerFilter) return false
    if (search) {
      const s = search.toLowerCase()
      return (r.opp.name ?? '').toLowerCase().includes(s) ||
             (r.opp.account ?? '').toLowerCase().includes(s) ||
             (r.opp.owner_name ?? '').toLowerCase().includes(s)
    }
    return true
  }), [rows, minSignals, focusKey, ownerFilter, search])

  return (
    <div style={{ padding: '14px 20px' }}>
      {/* Signal pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {SIGNAL_COLS.map(col => {
          const active = focusKey === col.key
          return (
            <button
              key={col.key}
              onClick={() => setFocusKey(active ? '' : col.key)}
              style={{
                background: active ? col.color : 'var(--surface)',
                color: active ? '#fff' : 'var(--text-td)',
                border: `1px solid ${active ? col.color : 'var(--border)'}`,
                borderLeft: `4px solid ${col.color}`,
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 11,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontWeight: 600 }}>{col.label}</span>
              <span style={{ marginLeft: 6, fontSize: 10, opacity: .8 }}>{totals[col.key]}</span>
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input
          placeholder="Search name / account / owner…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-filter"
          style={{ minWidth: 240 }}
        />
        <select className="pl-filter" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
          <option value="">All owners</option>
          {owners.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Min signals
          <select
            className="pl-filter"
            value={minSignals}
            onChange={e => setMinSignals(Number(e.target.value))}
          >
            {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}+</option>)}
          </select>
        </label>
        {(focusKey || ownerFilter || search || minSignals !== 1) && (
          <button className="back-btn" onClick={() => { setFocusKey(''); setOwnerFilter(''); setSearch(''); setMinSignals(1) }}>
            Reset
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-meta)' }}>
          {filtered.length} of {rows.length} opportunities
        </span>
      </div>

      {/* Trigger matrix */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: 'var(--surface2)', zIndex: 2 }}>Opportunity</th>
              <th>Owner</th>
              <th style={{ textAlign: 'right' }}>ARR</th>
              <th style={{ textAlign: 'center' }}>Signals</th>
              {SIGNAL_COLS.map(c => (
                <th key={c.key} style={{ textAlign: 'center', color: c.color }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered
              .sort((a, b) => b.count - a.count || (b.opp.arr ?? 0) - (a.opp.arr ?? 0))
              .slice(0, 300)
              .map(r => {
                const isOpen = drill?.oppId === r.opp.id
                return (
                  <Fragment key={r.opp.id}>
                    <tr>
                      <td style={{ position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>
                        {oppLink(r.opp.id, r.opp.name)}
                      </td>
                      <td>{r.opp.owner_name ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{fmtARR(r.opp.arr)}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: r.count >= 4 ? '#dc2626' : r.count >= 2 ? '#d97706' : 'var(--text-td)' }}>
                        {r.count}
                      </td>
                      {SIGNAL_COLS.map(c => {
                        const active = isOpen && drill?.label === c.label
                        return (
                          <td key={c.key} style={{ textAlign: 'center' }}>
                            {r.sig[c.key]
                              ? <button
                                  type="button"
                                  onClick={() => setDrill(active ? null : { oppId: r.opp.id, label: c.label })}
                                  title={`Open inline — trigger: ${c.label}`}
                                  style={{
                                    display: 'inline-block',
                                    width: 12, height: 12,
                                    borderRadius: '50%',
                                    background: c.color,
                                    cursor: 'pointer',
                                    border: active ? '2px solid var(--text-strong)' : 'none',
                                    padding: 0,
                                  }}
                                />
                              : <span style={{ color: 'var(--text-meta)' }}>·</span>}
                          </td>
                        )
                      })}
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={4 + SIGNAL_COLS.length} style={{ padding: 0, background: 'var(--surface2)' }}>
                          <DrillPanel
                            oppId={r.opp.id}
                            triggerLabel={drill!.label}
                            queueItems={queueItems}
                            loading={queueLoading}
                            error={queueError}
                            onClose={() => setDrill(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            {filtered.length === 0 && (
              <tr><td colSpan={4 + SIGNAL_COLS.length} style={{ textAlign: 'center', color: 'var(--text-meta)', padding: '24px 0' }}>
                No opportunities match your filters
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Inline drilldown panel (mirrors Signals page card expansion) ────────────

function DrillPanel({
  oppId, triggerLabel, queueItems, loading, error, onClose,
}: {
  oppId: string
  triggerLabel: string
  queueItems: QueueItem[] | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  const item = queueItems?.find(i => i.opportunity.id === oppId) ?? null

  return (
    <div style={{ padding: '12px 18px 18px', borderTop: '1px solid var(--border)' }}>
      {/* Trigger banner */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 12,
        padding: '8px 12px',
        background: '#fef3c7',
        border: '1px solid #fde68a',
        borderRadius: 6,
        color: '#92400e',
        fontSize: 12,
      }}>
        <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', fontSize: 10 }}>
          Triggered by
        </span>
        <span style={{ fontWeight: 600 }}>{triggerLabel}</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: '1px solid #d97706',
            color: '#92400e',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>

      {loading && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Loading opportunity details…
        </div>
      )}
      {error && !loading && (
        <div style={{ padding: 16, color: '#dc2626', fontSize: 13 }}>Error: {error}</div>
      )}
      {!loading && !error && !item && queueItems && (
        <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
          Opportunity not in workflow queue (only opps in active gates are loaded into the queue).
        </div>
      )}
      {item && <ExpandedDetails item={item} />}
    </div>
  )
}
