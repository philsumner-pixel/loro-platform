import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun } from '@/lib/ingest/utils'

// ── CORPUS ANOMALY DETECTOR ─────────────────────────────────────────────
// The original /api/patterns/detect asks "does this match one of five
// hardcoded rules for these 11 entities". This asks "what is statistically
// unusual across the whole corpus", so it works for any entity the firehose
// discovers — nothing is hand-listed.
//
// Three signals (all SQL, computed over loro_source_events):
//   burst        — entity filing far above its own 90-day baseline
//   cross_source — same entity in 2+ different registers in a tight window
//   rare_type    — statistically unusual filing type (late filing, delisting)
//
// Candidates are written with lane classification attached where the corpus
// embedding allows it. Cron: every 2 hours at :05 (before novelty at :30).

export const runtime = 'nodejs'
export const maxDuration = 60

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface BurstRow {
  entity_id: string; entity_name: string
  recent_events: number; baseline_rate: number; burst_ratio: number
  sources: string[]; event_types: string[]
}
interface CrossRow {
  entity_id: string; entity_name: string
  source_count: number; sources: string[]; event_count: number
  first_seen: string; last_seen: string
}
interface RareRow {
  event_type: string; recent_count: number; corpus_share: number
  entity_names: string[]
}

/**
 * Don't recreate a candidate while an open one exists for the same SUBJECT.
 * Matching on headline alone let two detectors describing the same phenomenon
 * in different words both create candidates — "Certara: 3 regulatory events in
 * 72 hours" and "Certara: filing activity 6x above its own baseline" are the
 * same story. When a subject is already open, the new signal is recorded on
 * the existing candidate instead.
 */
async function alreadyOpen(
  sb: ReturnType<typeof getSupabase>,
  headline: string,
  subjectKey?: string | null,
  signal?: string
): Promise<boolean> {
  const key = (subjectKey ?? headline.split(':')[0])
    .toLowerCase().replace(/[^a-z0-9]/g, '')

  const { data: existing } = await sb
    .from('loro_story_candidates')
    .select('id, merged_signals')
    .eq('subject_key', key)
    .in('status', ['new', 'shortlisted', 'in_draft'])
    .limit(1)

  if (existing?.length) {
    // Record the additional signal on the candidate already in the queue, so
    // the journalist sees that several detectors agree rather than seeing the
    // same subject twice.
    const merged = (existing[0].merged_signals ?? []) as unknown[]
    await sb.from('loro_story_candidates')
      .update({ merged_signals: [...merged, { headline, signal: signal ?? null }] })
      .eq('id', existing[0].id)
    return true
  }
  return false
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startRun('corpus_detector')
  const sb = getSupabase()
  const errors: string[] = []
  const created: string[] = []
  let considered = 0

  try {
    // ── SIGNAL 1: burst ────────────────────────────────────────────────
    const { data: bursts } = await sb.rpc('loro_signal_entity_burst', {
      window_days: 7, baseline_days: 90, min_events: 3,
    })

    for (const b of ((bursts ?? []) as BurstRow[]).slice(0, 10)) {
      considered++
      if (b.burst_ratio < 3) continue
      const headline = `${b.entity_name}: filing activity ${b.burst_ratio}x above its own baseline`
      if (await alreadyOpen(sb, headline, b.entity_name, 'entity_burst')) continue

      const { error } = await sb.from('loro_story_candidates').insert({
        headline,
        subject_key: b.entity_name.toLowerCase().replace(/[^a-z0-9]/g, ''),
        standfirst: `${b.entity_name} has produced ${b.recent_events} filings in the last 7 days against an expected ${b.baseline_rate}. Sources: ${b.sources.join(', ')}.`,
        category: 'Ownership Intel',
        lane_slug: 'ownership-control',
        anomaly_score: Math.min(10, 4 + b.burst_ratio / 2),
        status: 'new',
        novelty_status: 'unchecked',
        detected_at: new Date().toISOString(),
        evidence_packet: {
          signal: 'entity_burst',
          entity: b.entity_name,
          recent_events: b.recent_events,
          baseline_rate: b.baseline_rate,
          burst_ratio: b.burst_ratio,
          sources: b.sources,
          event_types: b.event_types,
        },
      })
      if (error) errors.push(`burst: ${error.message}`)
      else created.push(headline)
    }

    // ── SIGNAL 2: cross-source corroboration ───────────────────────────
    const { data: cross } = await sb.rpc('loro_signal_cross_source', {
      window_days: 14, min_sources: 2,
    })

    for (const c of ((cross ?? []) as CrossRow[]).slice(0, 10)) {
      considered++
      const headline = `${c.entity_name}: activity across ${c.source_count} registers within 14 days`
      if (await alreadyOpen(sb, headline, c.entity_name, 'cross_source')) continue

      const { error } = await sb.from('loro_story_candidates').insert({
        headline,
        subject_key: c.entity_name.toLowerCase().replace(/[^a-z0-9]/g, ''),
        standfirst: `${c.entity_name} appears in ${c.sources.join(', ')} between ${c.first_seen} and ${c.last_seen} — ${c.event_count} events. Corroboration across separate registers is a stronger signal than any single filing.`,
        category: 'Regulation',
        lane_slug: 'regulation-enforcement',
        anomaly_score: Math.min(10, 5 + c.source_count),
        status: 'new',
        novelty_status: 'unchecked',
        detected_at: new Date().toISOString(),
        evidence_packet: {
          signal: 'cross_source',
          entity: c.entity_name,
          sources: c.sources,
          source_count: c.source_count,
          event_count: c.event_count,
          window: [c.first_seen, c.last_seen],
        },
      })
      if (error) errors.push(`cross: ${error.message}`)
      else created.push(headline)
    }

    // ── SIGNAL 3: rare event types ─────────────────────────────────────
    const { data: rare } = await sb.rpc('loro_signal_rare_event_type', {
      window_days: 7, max_share: 0.02,
    })

    for (const r of ((rare ?? []) as RareRow[]).slice(0, 6)) {
      considered++
      const who = (r.entity_names ?? []).filter(n => n && n !== 'unknown')
      if (!who.length) continue
      const headline = `Unusual filing type ${r.event_type.replace(/_/g, ' ')} — ${who.slice(0, 3).join(', ')}`
      if (await alreadyOpen(sb, headline)) continue

      const { error } = await sb.from('loro_story_candidates').insert({
        headline,
        standfirst: `${r.event_type.replace(/_/g, ' ')} accounts for just ${(r.corpus_share * 100).toFixed(2)}% of all recorded filings, and ${r.recent_count} landed in the last 7 days. Rare filing types are disproportionately newsworthy.`,
        category: 'Regulation',
        lane_slug: 'regulation-enforcement',
        anomaly_score: Math.min(10, 5 + (1 - r.corpus_share) * 3),
        status: 'new',
        novelty_status: 'unchecked',
        detected_at: new Date().toISOString(),
        evidence_packet: {
          signal: 'rare_event_type',
          event_type: r.event_type,
          corpus_share: r.corpus_share,
          recent_count: r.recent_count,
          entities: who,
        },
      })
      if (error) errors.push(`rare: ${error.message}`)
      else created.push(headline)
    }

    await completeRun(runId, { found: considered, new: created.length, duplicate: 0 }, errors)

    return NextResponse.json({
      ok: true,
      signals_considered: considered,
      candidates_created: created.length,
      created: created.slice(0, 10),
      errors: errors.slice(0, 3),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await completeRun(runId, { found: considered, new: created.length, duplicate: 0 }, [msg])
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
