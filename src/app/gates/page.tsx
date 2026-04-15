import Link from 'next/link'
import {
  GATES,
  GATE_ORDER,
  CRITICAL_TIMELINE,
  CLOSING_SCENARIOS,
  SUPABASE_FLAG_TO_GATE,
  type GateDefinition,
  type GateId,
} from '@/lib/gate-triggers'

export const dynamic = 'force-static'

const FLAG_BY_GATE: Partial<Record<GateId, string[]>> = (() => {
  const out: Partial<Record<GateId, string[]>> = {}
  for (const [flag, gid] of Object.entries(SUPABASE_FLAG_TO_GATE)) {
    if (!gid) continue
    out[gid] = [...(out[gid] ?? []), flag]
  }
  return out
})()

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'danger' | 'success' }) {
  const colors: Record<string, { bg: string; fg: string; border: string }> = {
    neutral: { bg: '#f1f5f9', fg: '#475569', border: '#e2e8f0' },
    accent:  { bg: '#dbeafe', fg: '#1d4ed8', border: '#bfdbfe' },
    danger:  { bg: '#fee2e2', fg: '#b91c1c', border: '#fecaca' },
    success: { bg: '#dcfce7', fg: '#15803d', border: '#bbf7d0' },
  }
  const c = colors[tone]
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 10,
      fontSize: 11,
      fontWeight: 600,
      background: c.bg,
      color: c.fg,
      border: `1px solid ${c.border}`,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

function GateCard({ gate }: { gate: GateDefinition }) {
  const flags = FLAG_BY_GATE[gate.id] ?? []
  const stages = Array.isArray(gate.sfStage) ? gate.sfStage : [gate.sfStage]

  return (
    <section id={gate.id} style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 20,
      marginBottom: 16,
      boxShadow: 'var(--shadow)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-meta)', letterSpacing: 1, textTransform: 'uppercase' }}>
          {gate.id.toUpperCase()}
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)' }}>{gate.title}</h2>
        <Pill tone="accent">{gate.window.start} → {gate.window.end}</Pill>
        {stages.map(s => <Pill key={s}>{s}</Pill>)}
        {gate.owners.map(o => <Pill key={o} tone="neutral">{o}</Pill>)}
        {flags.map(f => <Pill key={f} tone="success">{f}</Pill>)}
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{gate.summary}</p>

      {/* Two-column grid for triggers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        {/* Time triggers */}
        <div>
          <h3 style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-meta)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Time triggers
          </h3>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <tbody>
              {gate.timeTriggers.map((t, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border2)' }}>
                  <td style={{ padding: '6px 8px 6px 0', width: 70, verticalAlign: 'top' }}>
                    <Pill tone="accent">{t.label}</Pill>
                  </td>
                  <td style={{ padding: '6px 0', verticalAlign: 'top', color: 'var(--text-td)' }}>
                    {t.action}
                    {t.source && <div style={{ fontSize: 11, color: 'var(--text-meta)', marginTop: 2 }}>{t.source}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Activity triggers */}
        <div>
          <h3 style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-meta)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Activity exit criteria
          </h3>
          <ul style={{ listStyle: 'none', fontSize: 13, color: 'var(--text-td)' }}>
            {gate.activityTriggers.map((a, i) => (
              <li key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border2)', display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--accent)', flexShrink: 0 }}>•</span>
                <div>
                  {a.description}
                  {(a.sfField || a.sfTaskSubject || a.source) && (
                    <div style={{ fontSize: 11, color: 'var(--text-meta)', marginTop: 2 }}>
                      {a.sfField && <code style={{ background: 'var(--surface2)', padding: '1px 6px', borderRadius: 3, marginRight: 6 }}>{a.sfField}</code>}
                      {a.sfTaskSubject && <span style={{ fontStyle: 'italic', marginRight: 6 }}>task: {a.sfTaskSubject}</span>}
                      {a.source && <span>{a.source}</span>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Required tasks */}
        <div>
          <h3 style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-meta)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Required SF tasks
          </h3>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <tbody>
              {gate.requiredTasks.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border2)' }}>
                  <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top', width: 200 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{r.subject}</div>
                    <div style={{ marginTop: 3, display: 'flex', gap: 4 }}>
                      <Pill tone="neutral">{r.assignee}</Pill>
                      {r.priority != null && <Pill tone="neutral">P{r.priority}</Pill>}
                    </div>
                  </td>
                  <td style={{ padding: '6px 0', verticalAlign: 'top', color: 'var(--text-td)' }}>{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Violation */}
        <div>
          <h3 style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Violation & escalation
          </h3>
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, fontSize: 13 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 6 }}>
              <Pill tone="danger">{gate.violation.deadline}</Pill>
              <strong style={{ color: '#991b1b' }}>{gate.violation.condition}</strong>
            </div>
            <div style={{ color: '#7f1d1d', marginBottom: gate.violation.violationDateField ? 6 : 0 }}>
              {gate.violation.escalation}
            </div>
            {gate.violation.violationDateField && (
              <code style={{ background: 'rgba(185,28,28,.08)', color: '#991b1b', padding: '2px 6px', borderRadius: 3, fontSize: 11 }}>
                {gate.violation.violationDateField}
              </code>
            )}
          </div>
        </div>
      </div>

      {/* Scenarios (gate 4/5) */}
      {gate.scenarios && gate.scenarios.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-meta)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Closing scenarios
          </h3>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>#</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Scenario</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Outcome</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Key action</th>
              </tr>
            </thead>
            <tbody>
              {gate.scenarios.map(s => (
                <tr key={s.number} style={{ borderBottom: '1px solid var(--border2)' }}>
                  <td style={{ padding: '8px', color: 'var(--text-meta)' }}>{s.number}</td>
                  <td style={{ padding: '8px', color: 'var(--text-strong)' }}>{s.name}</td>
                  <td style={{ padding: '8px' }}>
                    <Pill tone={s.outcome === 'Closed-Won' || s.outcome === 'Auto-Renewed' ? 'success' : s.outcome === 'Closed-Lost' ? 'danger' : 'neutral'}>
                      {s.outcome}
                    </Pill>
                  </td>
                  <td style={{ padding: '8px', color: 'var(--text-td)' }}>{s.keyAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default function GatesPage() {
  return (
    <div>
      {/* Header — mirrors .page-header on /pipeline */}
      <header className="page-header">
        <span className="brand">Gate &amp; Trigger Framework</span>
        <span className="header-meta">
          7-gate renewal lifecycle · v1.0 · Source: Renewal_Gate_Trigger_Framework.docx (April 2026)
        </span>
        <Link href="/pipeline" className="view-toggle-btn" style={{ border: '1px solid var(--border)' }}>
          ← ISR Dashboard
        </Link>
        <Link href="/demo/index.html" className="view-toggle-btn" style={{ border: '1px solid var(--border)' }}>
          Reports
        </Link>
      </header>

      <div style={{ padding: '18px 20px', maxWidth: 1280, margin: '0 auto' }}>
        {/* Critical timeline */}
        <section style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
          boxShadow: 'var(--shadow)',
        }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-meta)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Critical timeline
          </h2>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {CRITICAL_TIMELINE.map((t, i) => (
              <div key={i} style={{
                flex: '0 0 auto',
                minWidth: 160,
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 10,
              }}>
                <Pill tone={t.daysBeforeRenewal <= 0 ? 'danger' : t.daysBeforeRenewal <= 30 ? 'neutral' : 'accent'}>
                  {t.label}
                </Pill>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-td)', lineHeight: 1.4 }}>{t.action}</div>
                {t.source && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-meta)' }}>{t.source}</div>}
              </div>
            ))}
          </div>
        </section>

        {/* Gate cards */}
        {GATE_ORDER.map(gid => <GateCard key={gid} gate={GATES[gid]} />)}

        {/* Global closing scenarios index */}
        <section style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 16,
          marginTop: 20,
          boxShadow: 'var(--shadow)',
        }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 4 }}>
            Ten closing scenarios
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            From the Closing Opportunities playbook. Every known outcome has a defined gate path.
          </p>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>#</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Scenario</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Outcome</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Gate</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Key action</th>
              </tr>
            </thead>
            <tbody>
              {CLOSING_SCENARIOS.map(s => {
                const gates = Array.isArray(s.gate) ? s.gate : [s.gate]
                return (
                  <tr key={s.number} style={{ borderBottom: '1px solid var(--border2)' }}>
                    <td style={{ padding: '8px', color: 'var(--text-meta)' }}>{s.number}</td>
                    <td style={{ padding: '8px', color: 'var(--text-strong)' }}>{s.name}</td>
                    <td style={{ padding: '8px' }}>
                      <Pill tone={s.outcome === 'Closed-Won' || s.outcome === 'Auto-Renewed' ? 'success' : s.outcome === 'Closed-Lost' ? 'danger' : 'neutral'}>
                        {s.outcome}
                      </Pill>
                    </td>
                    <td style={{ padding: '8px' }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {gates.map(g => (
                          <a key={g} href={`#${g}`} style={{ textDecoration: 'none' }}>
                            <Pill tone="accent">{g}</Pill>
                          </a>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '8px', color: 'var(--text-td)' }}>{s.keyAction}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <footer style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-meta)', textAlign: 'center' }}>
          Backend source: <code>src/lib/gate-triggers.ts</code> · JSON endpoint: <code>/api/gate-triggers</code>
        </footer>
      </div>
    </div>
  )
}
