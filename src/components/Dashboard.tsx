'use client'

import { useState, useMemo, useCallback } from 'react'
import type { Opportunity, LastRefresh, TabId } from '@/lib/types'
import type { PipelineKpis, PipelineOpportunity } from '@/lib/salesforce-api'
import PipelineDashboard from './PipelineDashboard'
import WorkflowQueue from './WorkflowQueue'
import { WorkflowSignalsView } from './SignalViews'
import GatesFramework from './GatesFramework'

// ── Helpers ──────────────────────────────────────────────────────────────────

const SF_BASE = 'https://trilogy-sales.lightning.force.com/lightning/r/Opportunity'

function oppLink(id: string, name: string) {
  return <a href={`${SF_BASE}/${id}/view`} target="_blank" rel="noreferrer">{name}</a>
}

function fmt(val: number | null, prefix = '') {
  if (val == null) return '—'
  const n = Math.abs(val)
  if (n >= 1_000_000) return `${prefix}${(val / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${prefix}${(val / 1_000).toFixed(0)}K`
  return `${prefix}${val.toFixed(0)}`
}

function daysFrom(dateStr: string | null) {
  if (!dateStr) return null
  const diff = Math.round((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
  return diff
}

function daysLabel(dateStr: string | null) {
  const d = daysFrom(dateStr)
  if (d == null) return '—'
  if (d === 0)  return 'Today'
  if (d > 0)   return `+${d}d`
  return `${d}d`
}

function badgeColor(stage: string | null) {
  const s = (stage ?? '').toLowerCase()
  if (s === 'finalizing')           return '#22c55e'
  if (s === 'proposal')             return '#3b82f6'
  if (['engaged', 'outreach'].includes(s)) return '#f59e0b'
  if (s === 'pending')              return '#94a3b8'
  if (s.includes('closed won'))     return '#16a34a'
  if (s.includes('closed lost'))    return '#dc2626'
  return '#64748b'
}

function arrColor(opp: Opportunity) {
  const arr = opp.arr ?? 0
  if (arr >= 100_000) return '#7c3aed'
  if (arr >= 50_000)  return '#2563eb'
  if (arr >= 20_000)  return '#0891b2'
  return undefined
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Tab config ────────────────────────────────────────────────────────────────

interface TabDef {
  id: TabId
  label: string
  filter: (o: Opportunity) => boolean
  description: string
  color: string
}

const TABS: TabDef[] = [
  { id: 'gate1',       label: 'Gate 1',      color: '#ef4444', description: '140D No Engagement',    filter: o => o.in_gate1 },
  { id: 'gate2',       label: 'Gate 2',      color: '#f97316', description: '90D Quote Not Sent',    filter: o => o.in_gate2 },
  { id: 'gate3',       label: 'Gate 3',      color: '#eab308', description: '30D Not Finalizing',    filter: o => o.in_gate3 },
  { id: 'gate4',       label: 'Gate 4',      color: '#dc2626', description: 'Past Due — Not Closed', filter: o => o.in_gate4 },
  { id: 'not_touched', label: 'Not Touched', color: '#8b5cf6', description: 'No Activity 7+ Days',   filter: o => o.in_not_touched },
  { id: 'past_due',    label: 'Past Due',    color: '#dc2626', description: 'Renewal Date Passed',   filter: o => o.in_past_due },
]

// ── Opportunity table columns ─────────────────────────────────────────────────

function OppRow({ opp }: { opp: Opportunity }) {
  const days = daysFrom(opp.renewal_date)
  const daysStr = daysLabel(opp.renewal_date)
  const urgentStyle = days != null && days <= 14 ? { color: '#dc2626', fontWeight: 600 } : undefined

  return (
    <tr>
      <td>{oppLink(opp.id, opp.name ?? opp.id)}</td>
      <td>{opp.owner_name ?? '—'}</td>
      <td>{opp.account ?? '—'}</td>
      <td>
        <span className="badge" style={{ background: badgeColor(opp.stage) }}>
          {opp.stage ?? '—'}
        </span>
      </td>
      <td style={urgentStyle}>{formatDate(opp.renewal_date)} <span style={{ color: 'var(--text-muted)' }}>({daysStr})</span></td>
      <td style={{ color: arrColor(opp) }}>{fmt(opp.arr, '$')}</td>
      <td>{formatDate(opp.last_activity_date)}</td>
      <td>{formatDate(opp.next_follow_up_date)}</td>
      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {opp.next_step ?? '—'}
      </td>
    </tr>
  )
}

// ── Full tab view ─────────────────────────────────────────────────────────────

function TabView({
  tab, opps, onBack,
}: {
  tab: TabDef
  opps: Opportunity[]
  onBack: () => void
}) {
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')

  const owners = useMemo(() => {
    const set = new Set(opps.map(o => o.owner_name).filter(Boolean) as string[])
    return Array.from(set).sort()
  }, [opps])

  const filtered = useMemo(() => {
    return opps.filter(o => {
      if (ownerFilter && o.owner_name !== ownerFilter) return false
      if (search) {
        const s = search.toLowerCase()
        return (o.name ?? '').toLowerCase().includes(s) ||
               (o.account ?? '').toLowerCase().includes(s) ||
               (o.owner_name ?? '').toLowerCase().includes(s)
      }
      return true
    })
  }, [opps, search, ownerFilter])

  const totalArr = useMemo(() =>
    filtered.reduce((s, o) => s + (o.arr ?? 0), 0),
  [filtered])

  return (
    <>
      <div className="table-nav">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <span className="table-nav-title" style={{ color: tab.color }}>
          {tab.label} — {tab.description}
        </span>
      </div>

      <div className="tab-content">
        <div className="tab-header">
          <div className="tab-stats">
            <span className="stat-pill">{filtered.length} records</span>
            {totalArr > 0 && (
              <span className="stat-pill">ARR {fmt(totalArr, '$')}</span>
            )}
          </div>
          <div className="tab-filters">
            <input
              placeholder="Search name / account / owner…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
              <option value="">All owners</option>
              {owners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Opportunity</th><th>Owner</th><th>Account</th>
                <th>Stage</th><th>Renewal</th><th>ARR</th>
                <th>Last Activity</th><th>Next Follow-Up</th><th>Next Step</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => <OppRow key={o.id} opp={o} />)}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── Gate card (dashboard grid) ────────────────────────────────────────────────

function GateCard({ tab, opps, onViewAll }: { tab: TabDef; opps: Opportunity[]; onViewAll: () => void }) {
  const totalArr = opps.reduce((s, o) => s + (o.arr ?? 0), 0)
  const preview  = opps.slice(0, 5)

  return (
    <div className="gate-card">
      <div className="gate-card-hdr">
        <div>
          <div className="gate-card-title" style={{ color: tab.color }}>{tab.label}</div>
          <div className="gate-card-meta">{tab.description} · {opps.length} opps{totalArr ? ` · ${fmt(totalArr, '$')}` : ''}</div>
        </div>
        <button className="view-all-btn" onClick={onViewAll}>View all →</button>
      </div>
      <div className="ct-wrap">
        <table className="ct-table">
          <thead>
            <tr>
              <th>Opportunity</th>
              <th className="ct-col">Renewal</th>
              <th className="ct-col">ARR</th>
            </tr>
          </thead>
          <tbody>
            {preview.map(o => (
              <tr key={o.id}>
                <td>{oppLink(o.id, o.name ?? o.id)}</td>
                <td className="ct-col">{formatDate(o.renewal_date)}</td>
                <td className="ct-col">{fmt(o.arr, '$')}</td>
              </tr>
            ))}
            {opps.length === 0 && (
              <tr><td colSpan={3} style={{ color: 'var(--text-meta)', textAlign: 'center', padding: '20px 0' }}>No records</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ tab, count, onClick }: { tab: TabDef; count: number; onClick: () => void }) {
  return (
    <div className="kpi-card" onClick={onClick}>
      <div className="kpi-title" style={{ fontSize: 22, fontWeight: 700, color: tab.color }}>{tab.label}</div>
      <div className="kpi-count" style={{ color: tab.color }}>{count}</div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

interface Props {
  opportunities: Opportunity[]
  pipelineOpps:  PipelineOpportunity[]
  lastRefresh:   LastRefresh | null
  pipelineKpis:  PipelineKpis | null
}

export default function Dashboard({ opportunities, pipelineOpps, lastRefresh, pipelineKpis }: Props) {
  const [activeTab, setActiveTab] = useState<TabId | null>(null)
  const [view, setView] = useState<'pipeline' | 'gates' | 'signals' | 'workflow' | 'framework'>('pipeline')
  const [dark, setDark] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')

  const tabOpps = useMemo(() => {
    const map: Record<string, Opportunity[]> = {}
    for (const tab of TABS) {
      map[tab.id] = opportunities.filter(tab.filter)
    }
    return map
  }, [opportunities])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setRefreshMsg('Triggering refresh…')
    try {
      const resp = await fetch('/api/refresh', { method: 'POST' })
      if (resp.ok) {
        setRefreshMsg('Refresh triggered — data updates in ~2 min.')
      } else {
        const body = await resp.json()
        setRefreshMsg(`Error: ${body.error ?? resp.status}`)
      }
    } catch (e) {
      setRefreshMsg('Network error')
    } finally {
      setRefreshing(false)
      setTimeout(() => setRefreshMsg(''), 10_000)
    }
  }, [])

  const refreshLabel = lastRefresh?.refreshed_at
    ? new Date(lastRefresh.refreshed_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : 'Never'

  const activeTabDef = TABS.find(t => t.id === activeTab)

  return (
    <div className={dark ? 'dark' : undefined}>
      {/* ── Header ── */}
      <header className="page-header">
        <span className="brand">ISR Dashboard</span>
        <span className="header-meta">
          Updated <strong>{refreshLabel}</strong>
          {refreshMsg && <> · <span style={{ color: '#3b82f6' }}>{refreshMsg}</span></>}
        </span>
        <div className="view-toggle">
          <button
            className={`view-toggle-btn${view === 'pipeline' ? ' active' : ''}`}
            onClick={() => { setView('pipeline'); setActiveTab(null) }}
          >
            Pipeline
          </button>
          <button
            className={`view-toggle-btn${view === 'gates' ? ' active' : ''}`}
            onClick={() => { setView('gates'); setActiveTab(null) }}
          >
            Gates
          </button>
        </div>
        <div className="view-toggle" aria-label="Reports">
          <button
            className={`view-toggle-btn${view === 'workflow' ? ' active' : ''}`}
            onClick={() => { setView('workflow'); setActiveTab(null) }}
          >
            Workflow
          </button>
          <button
            className={`view-toggle-btn${view === 'framework' ? ' active' : ''}`}
            onClick={() => { setView('framework'); setActiveTab(null) }}
          >
            Triggers
          </button>
        </div>
        <button className="theme-toggle" onClick={() => setDark(d => !d)}>
          {dark ? '☀ Light' : '☾ Dark'}
        </button>
        <button className="refresh-btn" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Updating…' : 'Update'}
        </button>
      </header>

      {/* ── Pipeline view ── */}
      {!activeTab && view === 'pipeline' && (
        <PipelineDashboard opportunities={pipelineOpps} liveKpis={pipelineKpis} />
      )}

      {/* ── Signals view ── */}
      {view === 'signals' && (
        <WorkflowQueue />
      )}

      {/* ── Workflow Signals view ── */}
      {view === 'workflow' && (
        <WorkflowSignalsView opportunities={opportunities} />
      )}

      {/* ── Gates framework view ── */}
      {view === 'framework' && (
        <GatesFramework />
      )}

      {/* ── Accountability view: gate detail ── */}
      {activeTabDef && view === 'gates' && (
        <TabView
          tab={activeTabDef}
          opps={tabOpps[activeTabDef.id] ?? []}
          onBack={() => setActiveTab(null)}
        />
      )}

      {/* ── Accountability view: gate grid ── */}
      {!activeTab && view === 'gates' && (
        <>
          <div className="kpi-bar">
            <div className="kpi-row">
              {TABS.map(tab => (
                <KpiCard
                  key={tab.id}
                  tab={tab}
                  count={tabOpps[tab.id]?.length ?? 0}
                  onClick={() => setActiveTab(tab.id)}
                />
              ))}
            </div>
          </div>

          <div className="dashboard-body">
            <div className="gate-grid">
              {TABS.map(tab => (
                <GateCard
                  key={tab.id}
                  tab={tab}
                  opps={tabOpps[tab.id] ?? []}
                  onViewAll={() => setActiveTab(tab.id)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
