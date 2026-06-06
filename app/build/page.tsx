import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'

export const metadata: Metadata = {
  title: 'Build Tracker',
  description: 'Live progress on the Loro build.',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

interface Milestone {
  id: string
  phase: 'Foundation' | 'Build' | 'Test' | 'Launch'
  title: string
  detail: string | null
  status: 'done' | 'in_progress' | 'todo' | 'blocked'
  effort: string | null
  sort_order: number
  is_launch_criterion: boolean
  updated_at: string
}

async function getMilestones(): Promise<Milestone[]> {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data } = await sb
    .from('loro_build_milestones')
    .select('*')
    .order('sort_order', { ascending: true })
  return (data as Milestone[]) ?? []
}

const PHASES: { key: Milestone['phase']; label: string; window: string }[] = [
  { key: 'Foundation', label: 'Foundation', window: 'Already built' },
  { key: 'Build', label: 'Build', window: 'June' },
  { key: 'Test', label: 'Test', window: 'July' },
  { key: 'Launch', label: 'Launch', window: 'August' },
]

const STATUS_META: Record<Milestone['status'], { label: string; dot: string; text: string }> = {
  done:        { label: 'Done',        dot: '#1E6B3A', text: '#1E6B3A' },
  in_progress: { label: 'In progress', dot: '#1A3A6B', text: '#1A3A6B' },
  todo:        { label: 'To do',        dot: '#BBBBBB', text: '#888888' },
  blocked:     { label: 'Waiting',     dot: '#B8860B', text: '#9A7000' },
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default async function BuildTrackerPage() {
  const milestones = await getMilestones()

  const total = milestones.length
  const done = milestones.filter(m => m.status === 'done').length
  const inProgress = milestones.filter(m => m.status === 'in_progress').length
  const pct = total ? Math.round(((done + inProgress * 0.5) / total) * 100) : 0

  const lastUpdated = milestones.reduce((latest, m) =>
    m.updated_at > latest ? m.updated_at : latest, milestones[0]?.updated_at ?? '')

  const launchCriteria = milestones.filter(m => m.is_launch_criterion)

  return (
    <main style={{ background: 'var(--paper2)', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '48px 32px 80px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
          <span style={{ fontFamily: '"Playfair Display", serif', fontSize: 26, fontWeight: 700, color: 'var(--blue)' }}>
            Loro
          </span>
          <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink4)' }}>
            Build Tracker
          </span>
        </div>
        <p style={{ fontSize: 14, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 28, maxWidth: 560 }}>
          Live status of the build, straight from the system itself. This page updates as the work moves &mdash; no status emails, no decks. Last change {fmtDate(lastUpdated)}.
        </p>

        {/* Overall progress */}
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', padding: '22px 24px', marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <span style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink4)' }}>
              Overall progress
            </span>
            <span style={{ fontFamily: '"Playfair Display", serif', fontSize: 30, fontWeight: 700, color: 'var(--blue)' }}>
              {pct}%
            </span>
          </div>
          <div style={{ height: 6, background: 'var(--paper3)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--blue)' }} />
          </div>
          <div style={{ display: 'flex', gap: 20, marginTop: 14, fontSize: 12, color: 'var(--ink3)' }}>
            <span><strong style={{ color: 'var(--green)' }}>{done}</strong> done</span>
            <span><strong style={{ color: 'var(--blue)' }}>{inProgress}</strong> in progress</span>
            <span><strong style={{ color: 'var(--ink4)' }}>{total - done - inProgress}</strong> remaining</span>
          </div>
        </div>

        {/* Phases */}
        {PHASES.map(phase => {
          const items = milestones.filter(m => m.phase === phase.key)
          if (!items.length) return null
          const phaseDone = items.every(m => m.status === 'done')
          return (
            <section key={phase.key} style={{ marginBottom: 36 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
                <h2 style={{ fontFamily: '"Playfair Display", serif', fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>
                  {phase.label}
                </h2>
                <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: phaseDone ? 'var(--green)' : 'var(--ink4)' }}>
                  {phase.window}{phaseDone ? ' \u00b7 complete' : ''}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--border)' }}>
                {items.map(m => {
                  const s = STATUS_META[m.status]
                  return (
                    <div key={m.id} style={{
                      background: 'var(--paper)', padding: '14px 18px',
                      display: 'grid', gridTemplateColumns: '14px 1fr auto', gap: 14, alignItems: 'start',
                    }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.dot, marginTop: 4,
                        boxShadow: m.status === 'in_progress' ? '0 0 0 3px rgba(26,58,107,0.15)' : 'none' }} />
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', marginBottom: m.detail ? 3 : 0 }}>
                          {m.is_launch_criterion && (
                            <span style={{ color: 'var(--blue)', marginRight: 6 }}>&#10003;</span>
                          )}
                          {m.title}
                        </div>
                        {m.detail && (
                          <div style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.55 }}>{m.detail}</div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 11, fontWeight: 500, color: s.text, letterSpacing: '0.04em' }}>
                          {s.label}
                        </div>
                        {m.effort && (
                          <div style={{ fontSize: 11, color: 'var(--ink5)', fontFamily: '"IBM Plex Mono", monospace', marginTop: 2 }}>
                            {m.effort}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}

        {/* Launch criteria callout */}
        <div style={{ background: 'var(--blue)', color: '#fff', padding: '24px 26px', marginTop: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
            The milestone trigger
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: 'rgba(255,255,255,0.92)', marginBottom: 14 }}>
            The launch payment triggers when all five of these are objectively true and we both sign off. No ambiguity about when &ldquo;done&rdquo; is done.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {launchCriteria.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>
                <span style={{
                  width: 16, height: 16, border: '1.5px solid rgba(255,255,255,0.4)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: c.status === 'done' ? '#fff' : 'transparent',
                }}>
                  {c.status === 'done' && <span style={{ color: 'var(--blue)', fontSize: 11 }}>&#10003;</span>}
                </span>
                {c.title}
              </div>
            ))}
          </div>
        </div>

        <p style={{ fontSize: 11, color: 'var(--ink5)', marginTop: 28, lineHeight: 1.6 }}>
          This tracker is generated live from the build system. Confidential &mdash; shared between Phil and Chris.
        </p>
      </div>
    </main>
  )
}
