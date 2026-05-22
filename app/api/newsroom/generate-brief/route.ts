import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Generates a publishable first draft from intelligence signal data
// Chris edits the remaining 25% — Loro writes the structure and evidence layer

export const runtime = 'nodejs'
export const maxDuration = 55

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function POST(req: NextRequest) {
  const { candidate_id } = await req.json()
  if (!candidate_id) return NextResponse.json({ error: 'candidate_id required' }, { status: 400 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 503 })

  const sb = getSupabase()

  // Fetch full candidate with coverage links
  const { data: candidate, error } = await sb
    .from('loro_story_candidates')
    .select('*')
    .eq('id', candidate_id)
    .single()

  if (error || !candidate) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })

  // Fetch entity details
  const entityIds = candidate.entity_ids ?? []
  const { data: entities } = entityIds.length
    ? await sb.from('loro_entities').select('name, entity_type, jurisdiction').in('id', entityIds)
    : { data: [] }

  // Fetch coverage links (what others have published)
  const { data: coverage } = await sb
    .from('loro_story_coverage')
    .select('publication, headline, url, similarity_score, published_at')
    .eq('candidate_id', candidate_id)
    .order('similarity_score', { ascending: false })
    .limit(5)

  // Fetch raw source events for this candidate
  const sourceEventIds = candidate.source_event_ids ?? []
  const { data: events } = sourceEventIds.length
    ? await sb
        .from('loro_source_events')
        .select('source, event_type, event_date, raw_content')
        .in('id', sourceEventIds.slice(0, 10))
    : { data: [] }

  // Build evidence narrative from source events
  const pdmrEvents = (events ?? []).filter((e: { source: string }) =>
    ['fca_pdmr', 'sec_form4', 'sec_8k'].includes(e.source)
  )
  const chEvents = (events ?? []).filter((e: { source: string }) => e.source === 'companies_house')

  const pdmrDetail = pdmrEvents.slice(0, 6).map((e: {
    event_type: string
    event_date: string
    raw_content: Record<string, unknown>
  }) => {
    const rc = e.raw_content ?? {}
    const parts = [
      rc.person_name && `${rc.person_name}`,
      rc.person_role && `(${rc.person_role})`,
      rc.signal_type && `— ${rc.signal_type}`,
      rc.shares_qty && `${Number(rc.shares_qty).toLocaleString()} shares`,
      rc.price_per_share && `@ ${rc.price_per_share}p`,
      rc.total_value && `(total: £${Number(rc.total_value).toLocaleString()})`,
      e.event_date && `on ${e.event_date}`,
    ].filter(Boolean)
    return parts.length > 1 ? parts.join(' ') : `${e.event_type} filing — ${e.event_date}`
  }).join('\n')

  const scoreBreakdown = candidate.evidence_packet?.score_breakdown as Record<string, number> | undefined
  const breakdownText = scoreBreakdown ? [
    `Base (${(candidate.evidence_packet?.pattern_code as string ?? 'pattern').replace(/_/g,' ')}): ${scoreBreakdown.base?.toFixed(1)}`,
    scoreBreakdown.eventBonus > 0 ? `+ Event count: +${scoreBreakdown.eventBonus?.toFixed(1)}` : '',
    scoreBreakdown.sourceBonus > 0 ? `+ Multi-source: +${scoreBreakdown.sourceBonus?.toFixed(1)}` : '',
    scoreBreakdown.crossJurisdictionBonus > 0 ? `+ Cross-jurisdiction: +${scoreBreakdown.crossJurisdictionBonus?.toFixed(1)}` : '',
    scoreBreakdown.temporalBonus > 0 ? `+ Temporal compression: +${scoreBreakdown.temporalBonus?.toFixed(1)}` : '',
  ].filter(Boolean).join('\n') : ''

  const coverageText = (coverage ?? []).length > 0
    ? (coverage ?? []).map((c: {
        publication: string; headline: string; url: string; similarity_score: number | null
      }) =>
        `- ${c.publication}: "${c.headline}" (similarity: ${((c.similarity_score ?? 0) * 100).toFixed(0)}%)`
      ).join('\n')
    : 'No comparable coverage found in monitored publications.'

  const entityText = (entities ?? []).map((e: {
    name: string; entity_type: string; jurisdiction: string
  }) =>
    `${e.name} (${e.entity_type}, ${e.jurisdiction})`
  ).join(', ') || 'Entity not resolved'

  const prompt = `You are an editorial intelligence engine for Loro, an independent payments intelligence publication. Generate a publishable first-draft news brief from the following regulatory intelligence signal. A journalist will edit and refine this — aim for 80% publishable quality.

---

SIGNAL DETECTED
Entity: ${entityText}
Pattern: ${(candidate.evidence_packet?.pattern_code as string ?? '').replace(/_/g,' ')}
Anomaly score: ${candidate.anomaly_score?.toFixed(1)}/10 (${candidate.editorial_opportunity?.replace(/_/g,' ')})
Detected: ${new Date(candidate.detected_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}

SCORE BREAKDOWN
${breakdownText || 'Score data not available'}

SOURCE EVENTS (${(events ?? []).length} total)
${pdmrDetail || 'Regulatory filings — see evidence packet'}
${chEvents.length > 0 ? `Companies House: ${chEvents.length} filing(s)` : ''}

EXISTING COVERAGE IN MONITORED PUBLICATIONS
${coverageText}

EDITORIAL ANGLE (engine suggestion)
${candidate.loro_angle_hypothesis || candidate.standfirst || 'Not yet generated'}

COVERAGE SUMMARY
${candidate.coverage_summary || candidate.novelty_note || 'Novelty status: ' + candidate.novelty_status}

---

Write the brief in this exact structure:

HEADLINE: [Publishable news headline — specific, factual, not sensationalist]

STANDFIRST: [One sentence, maximum 30 words, capturing the essential news value]

BODY:
[Paragraph 1 — the lede: the most important fact, stated plainly. Who, what, when. ~50 words]

[Paragraph 2 — context: what is this entity, why does it matter to payments industry readers. ~60 words]

[Paragraph 3 — the evidence: what the data shows specifically. Cite the source events, the filing counts, the anomaly score context. Use hedged language: "suggests", "consistent with", "raises the question of". ~80 words]

[Paragraph 4 — significance: what this pattern historically precedes, what it might indicate. Do not predict — observe. ~60 words]

[Paragraph 5 — what to watch: the specific data points, filings or announcements that would confirm or contradict the signal. ~50 words]

REPORTER NOTE: [One sentence for Chris — what call to make, what document to request, what to verify before publishing]

---

Write only the structured brief above. No preamble. Do not editorialize beyond what the data supports. Do not state conclusions as facts. Report what the data shows.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(40000),
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `Anthropic API error: ${err}` }, { status: 500 })
    }

    const data = await res.json()
    const brief = data.content?.[0]?.text ?? ''

    // Save to candidate
    await sb.from('loro_story_candidates')
      .update({ ai_brief: brief })
      .eq('id', candidate_id)

    return NextResponse.json({ brief, candidate_id })

  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Generation failed'
    }, { status: 500 })
  }
}
