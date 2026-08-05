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
  const { data, error } = await sb.rpc('loro_source_health')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const health = (data ?? []) as Health[]
  const problems = health.filter(h => BAD.has(h.status))
  const quiet = health.filter(h => h.status === 'quiet')
  const healthy = health.filter(h => h.status === 'healthy')

  // Only alert when the set of problems has changed since the last check —
  // repeating the same message daily trains people to ignore it.
  const fingerprint = problems.map(p => `${p.slug}:${p.status}`).sort().join('|')

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
  if (webhook && changed && problems.length && !dryRun) {
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
            `*Loro source health: ${problems.length} source${problems.length > 1 ? 's' : ''} need attention*`,
            ...lines,
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
    state_changed: changed,
    alerted,
    slack_configured: Boolean(webhook),
  })
}
