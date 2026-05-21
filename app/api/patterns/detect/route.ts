import { NextResponse } from 'next/server'
import { getSupabase, startRun, completeRun } from '@/lib/ingest/utils'
import { scorePattern, generateHeadline, classifyEditorialOpportunity, editorialPriority } from '@/lib/patterns/scoring'

// Runs every 2 hours via Vercel Cron
// Detects patterns in loro_source_events → writes to loro_story_candidates

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startRun('pattern_detector')
  const sb = getSupabase()
  const errors: string[] = []
  let candidatesCreated = 0
  let patternsRun = 0

  try {
    // Load active patterns from DB
    const { data: patterns } = await sb
      .from('loro_patterns')
      .select('*')
      .eq('active', true)

    if (!patterns?.length) {
      await completeRun(runId, { found: 0, new: 0, duplicate: 0 })
      return NextResponse.json({ message: 'No active patterns' })
    }

    // ── PATTERN 1: Temporal event cluster ────────────────────────────
    // 3+ events for the same entity within 72 hours
    const temporalPattern = patterns.find(p => p.code === 'temporal_cluster')
    if (temporalPattern) {
      patternsRun++
      try {
        const { data: clusters } = await sb.rpc('detect_temporal_clusters', {
          window_hours: 72,
          min_events: 3,
          lookback_days: 7,
        })

        for (const cluster of (clusters ?? [])) {
          const breakdown = scorePattern({
            patternCode: 'temporal_cluster',
            patternName: temporalPattern.name,
            baseScore: temporalPattern.base_anomaly_score,
            eventCount: cluster.event_count,
            sourceCount: cluster.source_count,
            distinctSources: cluster.sources ?? [],
            events: cluster.events ?? [],
            scorePerExtraEvent: temporalPattern.score_per_extra_event,
            scorePerExtraSource: temporalPattern.score_per_extra_source,
          })

          const opportunity = classifyEditorialOpportunity(breakdown.total, 'unchecked', temporalPattern.default_editorial_opportunity)
          const { headline, standfirst, category } = generateHeadline({
            patternCode: 'temporal_cluster',
            entityName: cluster.entity_name,
            groupName: cluster.group_name,
            eventCount: cluster.event_count,
            sources: cluster.sources ?? [],
            eventTypes: cluster.event_types ?? [],
            anomalyScore: breakdown.total,
          })

          const created = await writeCandidate({
            headline,
            standfirst,
            category,
            anomalyScore: breakdown.total,
            patternCode: 'temporal_cluster',
            entityIds: cluster.entity_id ? [cluster.entity_id] : [],
            sourceEventIds: cluster.event_ids ?? [],
            sources: cluster.sources ?? [],
            opportunity,
            priority: editorialPriority(breakdown.total, opportunity),
            evidencePacket: {
              pattern: 'temporal_cluster',
              score_breakdown: breakdown,
              event_count: cluster.event_count,
              sources: cluster.sources,
              window_hours: 72,
              first_event: cluster.first_event,
              last_event: cluster.last_event,
              events: cluster.events,
            },
          })

          if (created) candidatesCreated++
        }
      } catch (err) {
        errors.push(`temporal_cluster: ${err instanceof Error ? err.message : 'error'}`)
      }
    }

    // ── PATTERN 2: Cross-source entity signal ─────────────────────────
    // Same entity in 2+ different sources within 7 days
    const crossSourcePattern = patterns.find(p => p.code === 'cross_source_signal')
    if (crossSourcePattern) {
      patternsRun++
      try {
        const { data: crossSignals } = await sb.rpc('detect_cross_source_signals', {
          window_days: 7,
          min_sources: 2,
        })

        for (const signal of (crossSignals ?? [])) {
          const breakdown = scorePattern({
            patternCode: 'cross_source_signal',
            patternName: crossSourcePattern.name,
            baseScore: crossSourcePattern.base_anomaly_score,
            eventCount: signal.event_count,
            sourceCount: signal.source_count,
            distinctSources: signal.distinct_sources ?? [],
            events: signal.events ?? [],
            scorePerExtraEvent: crossSourcePattern.score_per_extra_event,
            scorePerExtraSource: crossSourcePattern.score_per_extra_source,
          })

          const opportunity = classifyEditorialOpportunity(breakdown.total, 'unchecked', crossSourcePattern.default_editorial_opportunity)
          const { headline, standfirst, category } = generateHeadline({
            patternCode: 'cross_source_signal',
            entityName: signal.entity_name,
            groupName: signal.group_name,
            eventCount: signal.event_count,
            sources: signal.distinct_sources ?? [],
            eventTypes: signal.event_types ?? [],
            anomalyScore: breakdown.total,
          })

          const created = await writeCandidate({
            headline, standfirst, category,
            anomalyScore: breakdown.total,
            patternCode: 'cross_source_signal',
            entityIds: signal.entity_id ? [signal.entity_id] : [],
            sourceEventIds: signal.event_ids ?? [],
            sources: signal.distinct_sources ?? [],
            opportunity,
            priority: editorialPriority(breakdown.total, opportunity),
            evidencePacket: {
              pattern: 'cross_source_signal',
              score_breakdown: breakdown,
              distinct_sources: signal.distinct_sources,
              event_count: signal.event_count,
              events: signal.events,
            },
          })

          if (created) candidatesCreated++
        }
      } catch (err) {
        errors.push(`cross_source_signal: ${err instanceof Error ? err.message : 'error'}`)
      }
    }

    // ── PATTERN 3: High-signal Companies House filings ────────────────
    // Director changes, PSC changes, share allotments in last 24 hours
    const chPattern = patterns.find(p => p.code === 'high_signal_ch_filing')
    if (chPattern) {
      patternsRun++
      try {
        const { data: chEvents } = await sb
          .from('loro_source_events')
          .select('*')
          .eq('source', 'companies_house')
          .eq('processed', false)
          .gt('created_at', new Date(Date.now() - 24 * 3600000).toISOString())
          .filter('raw_content->>high_signal', 'eq', 'true')

        for (const event of (chEvents ?? [])) {
          const breakdown = scorePattern({
            patternCode: 'high_signal_ch_filing',
            patternName: chPattern.name,
            baseScore: chPattern.base_anomaly_score,
            eventCount: 1,
            sourceCount: 1,
            distinctSources: ['companies_house'],
            events: [{ event_date: event.event_date, source: event.source, event_type: event.event_type }],
            scorePerExtraEvent: chPattern.score_per_extra_event,
            scorePerExtraSource: chPattern.score_per_extra_source,
          })

          const opportunity = classifyEditorialOpportunity(breakdown.total, 'unchecked', chPattern.default_editorial_opportunity)
          const { headline, standfirst, category } = generateHeadline({
            patternCode: 'high_signal_ch_filing',
            entityName: event.raw_content?.company_name as string,
            eventCount: 1,
            sources: ['companies_house'],
            eventTypes: [event.raw_content?.filing_type as string],
            anomalyScore: breakdown.total,
          })

          const created = await writeCandidate({
            headline, standfirst, category,
            anomalyScore: breakdown.total,
            patternCode: 'high_signal_ch_filing',
            entityIds: event.entity_id ? [event.entity_id] : [],
            sourceEventIds: [event.id],
            sources: ['companies_house'],
            opportunity,
            priority: editorialPriority(breakdown.total, opportunity),
            evidencePacket: {
              pattern: 'high_signal_ch_filing',
              score_breakdown: breakdown,
              filing_type: event.raw_content?.filing_type,
              company_number: event.raw_content?.company_number,
              filing_date: event.event_date,
              description: event.raw_content?.description,
            },
          })

          if (created) candidatesCreated++
          // Mark as processed
          await sb.from('loro_source_events').update({ processed: true, processed_at: new Date().toISOString() }).eq('id', event.id)
        }
      } catch (err) {
        errors.push(`high_signal_ch_filing: ${err instanceof Error ? err.message : 'error'}`)
      }
    }

    // ── PATTERN 4: PDMR/SEC Form 4 cluster ────────────────────────────
    const pdmrPattern = patterns.find(p => p.code === 'pdmr_pre_announcement') ??
      patterns.find(p => p.code === 'sec_form4_cluster')

    if (pdmrPattern) {
      patternsRun++
      try {
        const { data: pdmrEvents } = await sb
          .from('loro_source_events')
          .select('*')
          .in('source', ['fca_pdmr', 'sec_form4'])
          .gt('created_at', new Date(Date.now() - 14 * 24 * 3600000).toISOString())

        // Group by entity_id or company name
        const grouped: Record<string, typeof pdmrEvents> = {}
        for (const evt of (pdmrEvents ?? [])) {
          const key = evt.entity_id ?? evt.raw_content?.company_name ?? 'unknown'
          if (!grouped[key]) grouped[key] = []
          grouped[key]!.push(evt)
        }

        for (const [key, evts] of Object.entries(grouped)) {
          if (!evts || evts.length < 2) continue

          const sources = [...new Set(evts.map((e: { source: string }) => e.source))]
          const breakdown = scorePattern({
            patternCode: 'pdmr_pre_announcement',
            patternName: 'PDMR pre-announcement pattern',
            baseScore: 8.5,
            eventCount: evts.length,
            sourceCount: sources.length,
            distinctSources: sources,
            events: evts.map((e: { event_date: string; source: string; event_type: string }) => ({
              event_date: e.event_date,
              source: e.source,
              event_type: e.event_type,
            })),
            scorePerExtraEvent: 0.4,
            scorePerExtraSource: 0.6,
          })

          const entityName = evts[0]?.raw_content?.company_name as string ?? key
          const opportunity = classifyEditorialOpportunity(breakdown.total, 'unchecked', 'exclusive')
          const { headline, standfirst, category } = generateHeadline({
            patternCode: 'pdmr_pre_announcement',
            entityName,
            eventCount: evts.length,
            sources,
            eventTypes: evts.map((e: { event_type: string }) => e.event_type),
            anomalyScore: breakdown.total,
          })

          const created = await writeCandidate({
            headline, standfirst, category,
            anomalyScore: breakdown.total,
            patternCode: 'pdmr_pre_announcement',
            entityIds: evts[0]?.entity_id ? [evts[0].entity_id] : [],
            sourceEventIds: evts.map((e: { id: string }) => e.id),
            sources,
            opportunity,
            priority: editorialPriority(breakdown.total, opportunity),
            evidencePacket: {
              pattern: 'pdmr_pre_announcement',
              score_breakdown: breakdown,
              event_count: evts.length,
              sources,
              events: evts.map((e: { event_date: string; source: string; event_type: string; raw_content: Record<string, unknown> }) => ({
                date: e.event_date,
                source: e.source,
                type: e.event_type,
                metadata: e.raw_content,
              })),
            },
          })

          if (created) candidatesCreated++
        }
      } catch (err) {
        errors.push(`pdmr_cluster: ${err instanceof Error ? err.message : 'error'}`)
      }
    }

    // Update pattern fire counts
    await sb.from('loro_patterns').update({ last_fired_at: new Date().toISOString() }).in('code', [
      'temporal_cluster', 'cross_source_signal', 'high_signal_ch_filing', 'pdmr_pre_announcement',
    ])

    await completeRun(runId, { found: patternsRun, new: candidatesCreated, duplicate: 0 }, errors)

    return NextResponse.json({
      patterns_run: patternsRun,
      candidates_created: candidatesCreated,
      errors: errors.length ? errors : undefined,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown'
    await completeRun(runId, { found: 0, new: 0, duplicate: 0 }, [msg])
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Write a candidate — deduplicates by headline similarity before inserting
async function writeCandidate(params: {
  headline: string
  standfirst: string
  category: string
  anomalyScore: number
  patternCode: string
  entityIds: string[]
  sourceEventIds: string[]
  sources: string[]
  opportunity: string
  priority: number
  evidencePacket: Record<string, unknown>
}): Promise<boolean> {
  const sb = getSupabase()

  // Deduplicate — don't create a candidate for the same entity+pattern within 24 hours
  const { count } = await sb
    .from('loro_story_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('headline', params.headline)
    .gt('created_at', new Date(Date.now() - 24 * 3600000).toISOString())

  if ((count ?? 0) > 0) return false

  const { error } = await sb.from('loro_story_candidates').insert({
    headline: params.headline,
    standfirst: params.standfirst,
    category: params.category,
    anomaly_score: params.anomalyScore,
    novelty_status: 'unchecked',
    editorial_opportunity: params.opportunity,
    editorial_priority: params.priority,
    source_event_ids: params.sourceEventIds,
    entity_ids: params.entityIds,
    evidence_packet: {
      ...params.evidencePacket,
      pattern_code: params.patternCode,
      sources: params.sources,
    },
    status: 'new',
    detected_at: new Date().toISOString(),
  })

  return !error
}
