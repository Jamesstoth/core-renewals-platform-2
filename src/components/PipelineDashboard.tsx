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

      {/* ── KPI cards (clickable — filter table by outcome) ── */}
      <div className="pl-kpi-row">
        <button
          type="button"
          onClick={() => setOutcomeFilter('')}
          className={`pl-kpi pl-kpi-blue${outcomeFilter === '' ? ' pl-kpi-active' : ''}`}
          style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', outline: outcomeFilter === '' ? '2px solid #2563eb' : 'none' }}
        >
          <div className="pl-kpi-label">Total Pipeline ARR</div>
          <div className="pl-kpi-value">{fmtARR(kpis.totalArr)}</div>
          <div className="pl-kpi-sub">{kpis.total.toLocaleString()} opportunities</div>
        </button>
        <button
          type="button"
          onClick={() => setOutcomeFilter(outcomeFilter === 'Likely to Win' ? '' : 'Likely to Win')}
          className={`pl-kpi pl-kpi-green${outcomeFilter === 'Likely to Win' ? ' pl-kpi-active' : ''}`}
          style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', outline: outcomeFilter === 'Likely to Win' ? '2px solid #16a34a' : 'none' }}
        >
          <div className="pl-kpi-label">Likely to Win</div>
          <div className="pl-kpi-value">{fmtARR(kpis.winArr)}</div>
          <div className="pl-kpi-sub">{kpis.winCount.toLocaleString()} deals</div>
        </button>
        <button
          type="button"
          onClick={() => setOutcomeFilter(outcomeFilter === 'Likely to Churn' ? '' : 'Likely to Churn')}
          className={`pl-kpi pl-kpi-red${outcomeFilter === 'Likely to Churn' ? ' pl-kpi-active' : ''}`}
          style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', outline: outcomeFilter === 'Likely to Churn' ? '2px solid #dc2626' : 'none' }}
        >
          <div className="pl-kpi-label">Likely to Churn</div>
          <div className="pl-kpi-value">{fmtARR(kpis.churnArr)}</div>
          <div className="pl-kpi-sub">{kpis.churnCount.toLocaleString()} deals</div>
        </button>
        <button
          type="button"
          onClick={() => setOutcomeFilter(outcomeFilter === 'Undetermined' ? '' : 'Undetermined')}
          className={`pl-kpi pl-kpi-warn${outcomeFilter === 'Undetermined' ? ' pl-kpi-active' : ''}`}
          style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', outline: outcomeFilter === 'Undetermined' ? '2px solid #d97706' : 'none' }}
        >
          <div className="pl-kpi-label">Undetermined</div>
          <div className="pl-kpi-value">{fmtARR(kpis.riskArr)}</div>
          <div className="pl-kpi-sub">{kpis.riskCount.toLocaleString()} deals</div>
        </button>
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
