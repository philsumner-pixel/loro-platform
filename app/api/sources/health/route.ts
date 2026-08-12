import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Source health check + alerting.
//
// The gap this closes: crons fire reliably, failures ARE recorded, but nobody
// reads loro_ingest_runs — so bis_statistics died on 21 May and went unnoticed
// for 76 days. Recording an error is not the same as knowing about it.
//
// Runs daily. Posts to Slack only when something is actually wrong, and only
// when the state has CHANGED, so it doesn't become noise that gets ignored —
// which is the usual way alerting fails.

export const runtime = 'nodejs'
export const maxDuration = 30

const BAD = new Set(['failing', 'silent', 'never run'])

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface Health {
  slug: string; label: string; status: string
  hours_since: number | null; failure_rate: number | null
  events_7d: number; runs_24h: number
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dry') === '1'

  if (!dryRun && cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = getSupabase()

  // Heartbeat first: this is the dead-man's switch. If this job stops running,
  // the absence of a recent beat is what raises the alarm — nothing else
  // watches the watcher.
  if (!dryRun) {
    await sb.from('loro_heartbeats').upsert(
      { job: 'source_health', last_beat: new Date().toISOString(), expected_interval_mins: 1440 },
      { onConflict: 'job' }
    )
  }

  const { data, error } = await sb.rpc('loro_source_health')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const health = (data ?? []) as Health[]

  // Source status alone would have missed every serious failure this week, so
  // check the pipeline stages, volume trend and stale heartbeats too.
  const [stagesRes, volumeRes, beatsRes, barrenRes] = await Promise.all([
    sb.rpc('loro_pipeline_stages'),
    sb.rpc('loro_source_volume_anomaly'),
    sb.rpc('loro_stale_heartbeats'),
    // The gap that let FCA PDMR run 7,950 times over three months producing
    // nothing while reporting success: the fetch worked and only the parse
    // failed, so it looked identical to a quiet register. Every other check
    // needs a baseline, and a source that never produced has none.
    sb.rpc('loro_barren_sources', { min_runs: 50 }),
  ])

  interface Stage { stage: string; pending: number; status: string }
  interface Volume { source: string; last_7d: number; weekly_avg: number; ratio: number; status: string }
  interface Beat { job: string; minutes_late: number }
  interface Barren { slug: string; label: string; total_runs: number
    events_total: number; verdict: string }

  const stages = (stagesRes.data ?? []) as Stage[]
  const volumes = (volumeRes.data ?? []) as Volume[]
  const beats = (beatsRes.data ?? []) as Beat[]
  const barren = (barrenRes.data ?? []) as Barren[]

  const stalledStages = stages.filter(s => s.status === 'stalled' || s.status === 'behind')
  const volumeDrops = volumes.filter(v => v.status === 'STOPPED' || v.status === 'sharp drop')
  const problems = health.filter(h => BAD.has(h.status))
  const quiet = health.filter(h => h.status === 'quiet')
  const healthy = health.filter(h => h.status === 'healthy')

  // Only alert when the set of problems has changed since the last check —
  // repeating the same message daily trains people to ignore it.
  const fingerprint = [
    ...problems.map(p => `src:${p.slug}:${p.status}`),
    ...stalledStages.map(s => `stage:${s.stage}:${s.status}`),
    ...volumeDrops.map(v => `vol:${v.source}:${v.status}`),
    ...beats.map(b => `beat:${b.job}`),
    ...barren.map(b => `barren:${b.slug}`),
  ].sort().join('|')

  const { data: last } = await sb
    .from('loro_health_checks')
    .select('fingerprint')
    .order('checked_at', { ascending: false })
    .limit(1)

  const changed = (last?.[0]?.fingerprint ?? '') !== fingerprint

  if (!dryRun) {
    await sb.from('loro_health_checks').insert({
      fingerprint,
      problem_count: problems.length,
      detail: { problems, quiet: quiet.map(q => q.slug), healthy: healthy.length },
    })
  }

  let alerted = false
  const webhook = process.env.SLACK_WEBHOOK_URL
  const anyProblem =
    problems.length + stalledStages.length + volumeDrops.length +
    beats.length + barren.length > 0

  if (webhook && changed && anyProblem && !dryRun) {
    const stageLines = stalledStages.map(s =>
      `• *Pipeline: ${s.stage}* — ${s.status}, ${s.pending.toLocaleString()} pending`)
    const volumeLines = volumeDrops.map(v =>
      `• *${v.source}* — ${v.status}: ${v.last_7d} this week vs ${v.weekly_avg}/week average`)
    const beatLines = beats.map(b =>
      `• *Job not running: ${b.job}* — ${Math.round(b.minutes_late)} minutes overdue`)
    const barrenLines = barren.map(b =>
      `• *${b.label}* — ${b.verdict}`)

    const lines = problems.map(p => {
      const detail = p.status === 'failing'
        ? `${p.failure_rate ?? '?'}% of ${p.runs_24h} attempts failed in 24h`
        : p.hours_since != null
          ? `last collected ${Math.round(p.hours_since)}h ago`
          : 'has never run'
      return `• *${p.label}* — ${p.status}: ${detail}`
    })

    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: [
            `*Loro pipeline health — ${problems.length + stalledStages.length + volumeDrops.length + beats.length} issue(s)*`,
            ...beatLines,
            ...barrenLines,
            ...lines,
            ...stageLines,
            ...volumeLines,
            `\n${healthy.length} healthy · ${quiet.length} quiet`,
            'https://loro-platform.vercel.app/sources',
          ].join('\n'),
        }),
      })
      alerted = true
    } catch {
      // Alerting must never break the check itself.
    }
  }

  return NextResponse.json({
    ok: true,
    checked: health.length,
    healthy: healthy.length,
    quiet: quiet.map(q => q.slug),
    problems: problems.map(p => ({
      slug: p.slug, status: p.status,
      failure_rate: p.failure_rate, hours_since: p.hours_since,
    })),
    pipeline_stages: stages,
    stalled_stages: stalledStages,
    volume_anomalies: volumeDrops,
    stale_heartbeats: beats,
    barren_sources: barren,
    state_changed: changed,
    alerted,
    slack_configured: Boolean(webhook),
  })
}
