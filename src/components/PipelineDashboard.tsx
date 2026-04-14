'use client'

import { useState, useMemo } from 'react'
import type { Opportunity } from '@/lib/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

const SF_BASE = 'https://trilogy-sales.lightning.force.com/lightning/r/Opportunity'

function fmtARR(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const OUTCOME_COLORS: Record<string, string> = {
  'Likely to Win':   '#16a34a',
  'Likely to Churn': '#dc2626',
  'Undetermined':    '#94a3b8',
}

const PALETTE = [
  '#2563eb','#16a34a','#dc2626','#d97706','#7c3aed',
  '#0891b2','#be185d','#65a30d','#ea580c','#0f766e','#6d28d9','#b45309',
]

// ── Donut chart (SVG) ─────────────────────────────────────────────────────────

function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return (
    <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-meta)', fontSize: 13 }}>
      No data
    </div>
  )

  const r = 64, cx = 80, cy = 80
  const circ = 2 * Math.PI * r
  let offset = 0
  const segs = data.map(d => {
    const dash = (d.value / total) * circ
    const seg = { ...d, dash, offset }
    offset += dash
    return seg
  })

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
      <svg width={160} height={160} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        {segs.map((seg, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={seg.color} strokeWidth={26}
            strokeDasharray={`${seg.dash} ${circ - seg.dash}`}
            strokeDashoffset={-seg.offset}
          />
        ))}
        <circle cx={cx} cy={cy} r={52} fill="var(--surface)" />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {segs.map((seg, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)' }}>{seg.label}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 600, paddingLeft: 16, color: 'var(--text-strong)' }}>
              {fmtARR(seg.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Horizontal bar chart ──────────────────────────────────────────────────────

function HBarChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {data.slice(0, 12).map((d, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 68px', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.label}>
            {d.label || 'Unknown'}
          </span>
          <div style={{ background: 'var(--border)', borderRadius: 3, height: 11, overflow: 'hidden' }}>
            <div style={{ width: `${(d.value / max) * 100}%`, background: d.color, height: '100%', borderRadius: 3 }} />
          </div>
          <span style={{ color: 'var(--text-faint)', textAlign: 'right', fontSize: 11 }}>{fmtARR(d.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Owner stacked bar ─────────────────────────────────────────────────────────

function OwnerChart({ data }: { data: { label: string; win: number; churn: number; other: number; total: number }[] }) {
  const maxTotal = Math.max(...data.map(d => d.total), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', gap: 14, marginBottom: 2, fontSize: 11, color: 'var(--text-muted)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, background: '#16a34a', borderRadius: 2 }} /> Win
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, background: '#dc2626', borderRadius: 2 }} /> Churn
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, background: '#94a3b8', borderRadius: 2 }} /> Undetermined
        </div>
      </div>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 36px', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.label}>
            {d.label.split(' ')[0]}
          </span>
          <div style={{ background: 'var(--border)', borderRadius: 3, height: 13, overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: `${(d.win   / maxTotal) * 100}%`, background: '#16a34a', height: '100%' }} />
            <div style={{ width: `${(d.churn / maxTotal) * 100}%`, background: '#dc2626', height: '100%' }} />
            <div style={{ width: `${(d.other / maxTotal) * 100}%`, background: '#94a3b8', height: '100%' }} />
          </div>
          <span style={{ color: 'var(--text-faint)', textAlign: 'right', fontSize: 11 }}>{d.total}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { opportunities: Opportunity[] }

export default function PipelineDashboard({ opportunities }: Props) {
  const [stageFilter,   setStageFilter]   = useState('')
  const [ownerFilter,   setOwnerFilter]   = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState('')
  const [sortCol, setSortCol] = useState('arr')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)

  // Filter options (from full dataset)
  const stages   = useMemo(() => [...new Set(opportunities.map(o => o.stage).filter(Boolean) as string[])].sort(), [opportunities])
  const owners   = useMemo(() => [...new Set(opportunities.map(o => o.owner_name).filter(Boolean) as string[])].sort(), [opportunities])
  const products = useMemo(() => [...new Set(opportunities.map(o => o.product).filter(Boolean) as string[])].sort(), [opportunities])
  const outcomes = useMemo(() => [...new Set(opportunities.map(o => o.probable_outcome || 'Undetermined'))].sort(), [opportunities])

  const filtered = useMemo(() => {
    return opportunities.filter(o => {
      if (stageFilter   && o.stage         !== stageFilter)   return false
      if (ownerFilter   && o.owner_name    !== ownerFilter)   return false
      if (productFilter && o.product       !== productFilter) return false
      if (outcomeFilter && (o.probable_outcome || 'Undetermined') !== outcomeFilter) return false
      return true
    })
  }, [opportunities, stageFilter, ownerFilter, productFilter, outcomeFilter])

  // KPIs
  const kpis = useMemo(() => {
    let totalArr = 0, winArr = 0, churnArr = 0, riskArr = 0
    let winCount = 0, churnCount = 0, riskCount = 0
    for (const o of filtered) {
      const arr = o.arr ?? 0
      totalArr += arr
      if (o.probable_outcome === 'Likely to Win')   { winArr   += arr; winCount++ }
      if (o.probable_outcome === 'Likely to Churn') { churnArr += arr; churnCount++ }
      if (!o.probable_outcome || o.probable_outcome === 'Undetermined') { riskArr += arr; riskCount++ }
    }
    return { totalArr, winArr, winCount, churnArr, churnCount, riskArr, riskCount, total: filtered.length }
  }, [filtered])

  // Chart data
  const outcomeData = useMemo(() => {
    const m: Record<string, number> = {}
    for (const o of filtered) { const k = o.probable_outcome || 'Undetermined'; m[k] = (m[k] ?? 0) + (o.arr ?? 0) }
    return Object.entries(m).map(([label, value]) => ({ label, value, color: OUTCOME_COLORS[label] ?? '#94a3b8' }))
  }, [filtered])

  const stageData = useMemo(() => {
    const m: Record<string, number> = {}
    for (const o of filtered) { const k = o.stage || 'Unknown'; m[k] = (m[k] ?? 0) + (o.arr ?? 0) }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }))
  }, [filtered])

  const productData = useMemo(() => {
    const m: Record<string, number> = {}
    for (const o of filtered) { const k = o.product || 'Unknown'; m[k] = (m[k] ?? 0) + (o.arr ?? 0) }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }))
  }, [filtered])

  const ownerData = useMemo(() => {
    const m: Record<string, { win: number; churn: number; total: number }> = {}
    for (const o of filtered) {
      const k = o.owner_name || 'Unknown'
      if (!m[k]) m[k] = { win: 0, churn: 0, total: 0 }
      m[k].total++
      if (o.probable_outcome === 'Likely to Win')   m[k].win++
      if (o.probable_outcome === 'Likely to Churn') m[k].churn++
    }
    return Object.entries(m)
      .filter(([k]) => !['Sales Integration', 'Unknown', ''].includes(k))
      .sort((a, b) => b[1].total - a[1].total)
      .map(([label, v]) => ({ label, ...v, other: v.total - v.win - v.churn }))
  }, [filtered])

  // Table
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortCol] ?? (sortCol === 'arr' ? 0 : '')
      const bv = (b as unknown as Record<string, unknown>)[sortCol] ?? (sortCol === 'arr' ? 0 : '')
      return (av < bv ? -1 : av > bv ? 1 : 0) * sortDir * -1
    })
  }, [filtered, sortCol, sortDir])

  function setSort(col: string) {
    if (sortCol === col) setSortDir(d => (d === -1 ? 1 : -1))
    else { setSortCol(col); setSortDir(-1) }
  }

  const anyFilter = stageFilter || ownerFilter || productFilter || outcomeFilter

  return (
    <div style={{ padding: '14px 20px' }}>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select className="pl-filter" value={stageFilter}   onChange={e => setStageFilter(e.target.value)}>
          <option value="">All Stages</option>
          {stages.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="pl-filter" value={ownerFilter}   onChange={e => setOwnerFilter(e.target.value)}>
          <option value="">All Owners</option>
          {owners.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select className="pl-filter" value={productFilter} onChange={e => setProductFilter(e.target.value)}>
          <option value="">All Products</option>
          {products.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="pl-filter" value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)}>
          <option value="">All Outcomes</option>
          {outcomes.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {anyFilter && (
          <button className="back-btn" onClick={() => { setStageFilter(''); setOwnerFilter(''); setProductFilter(''); setOutcomeFilter('') }}>
            ✕ Reset
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-meta)' }}>
          {filtered.length.toLocaleString()} opportunities
        </span>
      </div>

      {/* ── KPI cards ── */}
      <div className="pl-kpi-row">
        <div className="pl-kpi pl-kpi-blue">
          <div className="pl-kpi-label">Total Pipeline ARR</div>
          <div className="pl-kpi-value">{fmtARR(kpis.totalArr)}</div>
          <div className="pl-kpi-sub">{kpis.total.toLocaleString()} opportunities</div>
        </div>
        <div className="pl-kpi pl-kpi-green">
          <div className="pl-kpi-label">Likely to Win</div>
          <div className="pl-kpi-value">{fmtARR(kpis.winArr)}</div>
          <div className="pl-kpi-sub">{kpis.winCount.toLocaleString()} deals</div>
        </div>
        <div className="pl-kpi pl-kpi-red">
          <div className="pl-kpi-label">Likely to Churn</div>
          <div className="pl-kpi-value">{fmtARR(kpis.churnArr)}</div>
          <div className="pl-kpi-sub">{kpis.churnCount.toLocaleString()} deals</div>
        </div>
        <div className="pl-kpi pl-kpi-warn">
          <div className="pl-kpi-label">Undetermined</div>
          <div className="pl-kpi-value">{fmtARR(kpis.riskArr)}</div>
          <div className="pl-kpi-sub">{kpis.riskCount.toLocaleString()} deals</div>
        </div>
      </div>

      {/* ── Charts row 1 ── */}
      <div className="pl-chart-row">
        <div className="pl-chart-box">
          <h3 className="pl-chart-title">Probable Outcome — ARR Split</h3>
          <DonutChart data={outcomeData} />
        </div>
        <div className="pl-chart-box">
          <h3 className="pl-chart-title">Pipeline by Stage — ARR</h3>
          <HBarChart data={stageData} />
        </div>
      </div>

      {/* ── Charts row 2 ── */}
      <div className="pl-chart-row">
        <div className="pl-chart-box">
          <h3 className="pl-chart-title">ARR by Product (Top 12)</h3>
          <HBarChart data={productData} />
        </div>
        <div className="pl-chart-box">
          <h3 className="pl-chart-title">Owner Performance — Outcome Breakdown</h3>
          <OwnerChart data={ownerData} />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="pl-chart-box" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 className="pl-chart-title" style={{ marginBottom: 0 }}>All Opportunities</h3>
          <span style={{ fontSize: 11, color: 'var(--text-meta)' }}>
            Showing {Math.min(sorted.length, 200).toLocaleString()} of {sorted.length.toLocaleString()}
          </span>
        </div>
        <div className="table-wrap" style={{ maxHeight: '55vh' }}>
          <table>
            <thead>
              <tr>
                {([
                  { key: 'name',             label: 'Opportunity'  },
                  { key: 'account',          label: 'Account'      },
                  { key: 'owner_name',       label: 'Owner'        },
                  { key: 'product',          label: 'Product'      },
                  { key: 'stage',            label: 'Stage'        },
                  { key: 'probable_outcome', label: 'Outcome'      },
                  { key: 'opp_status',       label: 'Status'       },
                  { key: 'arr',              label: 'ARR'          },
                  { key: 'renewal_date',     label: 'Renewal Date' },
                ] as { key: string; label: string }[]).map(col => (
                  <th key={col.key} onClick={() => setSort(col.key)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    {col.label}{sortCol === col.key ? (sortDir === -1 ? ' ▼' : ' ▲') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 200).map(o => {
                const outcome = o.probable_outcome || 'Undetermined'
                const status  = o.opp_status || 'Unknown'
                return (
                  <tr key={o.id}>
                    <td>
                      <a href={`${SF_BASE}/${o.id}/view`} target="_blank" rel="noreferrer">
                        {o.name ?? o.id}
                      </a>
                    </td>
                    <td>{o.account ?? '—'}</td>
                    <td>{(o.owner_name ?? '—').split(' ')[0]}</td>
                    <td>{o.product ?? '—'}</td>
                    <td>
                      <span className="badge" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                        {o.stage ?? '—'}
                      </span>
                    </td>
                    <td>
                      <span className="badge" style={{
                        background: outcome === 'Likely to Win' ? '#dcfce7' : outcome === 'Likely to Churn' ? '#fee2e2' : '#f1f5f9',
                        color:      outcome === 'Likely to Win' ? '#15803d' : outcome === 'Likely to Churn' ? '#b91c1c' : '#475569',
                      }}>
                        {outcome}
                      </span>
                    </td>
                    <td>
                      <span className="badge" style={{
                        background: status === 'On Track' ? '#dcfce7' : status === 'Warning' ? '#fef3c7' : status === 'Attention Required' ? '#ffedd5' : '#f1f5f9',
                        color:      status === 'On Track' ? '#15803d' : status === 'Warning' ? '#92400e' : status === 'Attention Required' ? '#9a3412' : '#475569',
                      }}>
                        {status}
                      </span>
                    </td>
                    <td>{o.arr != null ? fmtARR(o.arr) : '—'}</td>
                    <td>{formatDate(o.renewal_date)}</td>
                  </tr>
                )
              })}
              {sorted.length > 200 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-meta)', padding: '12px' }}>
                    … and {(sorted.length - 200).toLocaleString()} more — use filters to narrow down
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
