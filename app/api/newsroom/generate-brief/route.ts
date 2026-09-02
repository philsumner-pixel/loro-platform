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
  // Documents attached to the evidence packet by the detector. This is where
  // the corpus detectors put them; source_event_ids is a legacy column they
  // never populate, so reading only that made every newly-enriched candidate
  // look evidence-free and the generator refused stories it could have written.
  const packetDocs = (candidate.evidence_packet?.source_events ?? []) as Array<{
    url?: string; date?: string; register?: string; title?: string; detail?: string
  }>

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

  // The subject, wherever the detector put it.
  //
  // cross_register_donor does not populate entity_ids — it works from donor
  // names in the registers, not resolved entity rows — so entityText read
  // 'Entity not resolved' and the model refused a story that named the company
  // in its own standfirst. Mirrors loro_evidence_subject() in the database, so
  // the prompt and the grader identify the subject the same way.
  const packet = (candidate.evidence_packet ?? {}) as Record<string, unknown>
  const packetSubject =
    (packet.entity as string) ||
    (packet.entity_name as string) ||
    (Array.isArray(packet.entities) ? (packet.entities as string[])[0] : undefined) ||
    (Array.isArray(packet.donor_names) ? (packet.donor_names as string[])[0] : undefined) ||
    (packet.donor_name as string) ||
    undefined

  const entityText = (entities ?? []).map((e: {
    name: string; entity_type: string; jurisdiction: string
  }) =>
    `${e.name} (${e.entity_type}, ${e.jurisdiction})`
  ).join(', ') || packetSubject || 'Entity not resolved'

  // Register detail, including the nested-per-register shape.
  //
  // A cross-register signal splits its values by register on purpose — the
  // story IS that the same money appears in two places — so the old block,
  // which read only top-level total_gbp and recipients, printed a bare company
  // number and dropped the substance. £5,000 to Nigel Huddleston MP in the
  // Electoral Commission register and £5,000 declared by David Davis in the
  // Register of Members' Financial Interests never reached the prompt.
  const REGISTER_LABELS: Record<string, string> = {
    electoral_commission: 'Electoral Commission (donations register)',
    declared_interests: "Register of Members' Financial Interests",
  }
  const nestedRegisters = Object.entries(packet)
    .filter(([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v)
                       && 'total_gbp' in (v as Record<string, unknown>))
    .map(([k, v]) => {
      const r = v as { count?: number; total_gbp?: number; recipients?: string[]; members?: string[] }
      const who = [...(r.recipients ?? []), ...(r.members ?? [])].join('; ')
      return `- ${REGISTER_LABELS[k] ?? k.replace(/_/g, ' ')}: ` +
             `${r.count ?? '?'} record(s), £${Number(r.total_gbp ?? 0).toLocaleString('en-GB')}` +
             (who ? ` — ${who}` : '')
    })

  const verificationNeeded = Array.isArray(packet.verification_needed)
    ? (packet.verification_needed as string[])
    : []

  const prompt = `You are an editorial intelligence engine for Loro, an independent business and regulatory intelligence publication. Generate a publishable first-draft news brief from the following signal. A journalist will edit and refine this — aim for 80% publishable quality.

BEFORE WRITING, CHECK THERE IS A STORY.
Write only if EITHER of these holds:
  (a) a named subject AND at least one dated filing or document, OR
  (b) a REGISTER RECORD below with a named counterparty and a value — the
      register entry IS the primary source; it does not need a separate filing.
Otherwise respond with exactly:

INSUFFICIENT EVIDENCE: <one line saying what is missing>

This mirrors loro_evidence_grade() in the database, which decides whether a
candidate reaches you at all. The two must agree: when the bar was stated in
prose here and computed separately there, the engine refused stories it had
been told were publishable.

Do NOT write an article about the detection itself. Headlines like "Anomaly
Detection System Flags Unresolved Signal" or "Entity Unconfirmed, Verification
Pending" are reports of our own uncertainty, not journalism — they name no
subject a reader could care about and they cannot be checked. Refusing is
always the right answer when the evidence is thin; a journalist can then find
the missing piece or discard the signal.

---

SIGNAL DETECTED
Entity: ${entityText}
Pattern: ${(candidate.evidence_packet?.pattern_code as string ?? '').replace(/_/g,' ')}
Anomaly score: ${candidate.anomaly_score?.toFixed(1)}/10 (${candidate.editorial_opportunity?.replace(/_/g,' ')})
Detected: ${new Date(candidate.detected_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}

SCORE BREAKDOWN
${breakdownText || 'Score data not available'}
${candidate.evidence_packet?.company_number ? `
REGISTER RECORD
Company number: ${candidate.evidence_packet.company_number}
${candidate.evidence_packet.total_gbp ? `Total value: £${Number(candidate.evidence_packet.total_gbp).toLocaleString('en-GB')}` : ''}
${candidate.evidence_packet.donation_count ? `Donations: ${candidate.evidence_packet.donation_count}` : ''}
${Array.isArray(candidate.evidence_packet.recipients) ? `Recipients: ${(candidate.evidence_packet.recipients as string[]).join('; ')}` : ''}
${nestedRegisters.length ? `Appears in ${nestedRegisters.length} registers:\n${nestedRegisters.join('\n')}` : ''}` : ''}
${verificationNeeded.length ? `
BEFORE PUBLICATION, A JOURNALIST MUST CHECK
${verificationNeeded.map(v => `- ${v}`).join('\n')}
State these as open questions in the brief. Do NOT assert that the two register
entries are the same money, or that the donation caused anything, unless the
records below actually show it.` : ''}

SOURCE DOCUMENTS (${packetDocs.length + (events ?? []).length} total)
${packetDocs.slice(0, 8).map(d =>
  `- ${d.date ?? 'undated'} · ${(d.register ?? '').replace(/_/g, ' ')} · ${d.title ?? 'filing'}` +
  `${d.detail ? `\n  ${d.detail.slice(0, 300)}` : ''}` +
  `${d.url ? `\n  ${d.url}` : ''}`).join('\n') || ''}
${pdmrDetail || ''}
${chEvents.length > 0 ? `Companies House: ${chEvents.length} filing(s)` : ''}
${packetDocs.length === 0 && (events ?? []).length === 0 ? 'No documents attached.' : ''}

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

EVIDENCE STANDARD (non-negotiable — this is how Loro content earns trust and gets cited)
Every brief must, wherever the source data allows:
- Use a SPECIFIC, SOURCED NUMBER in place of any vague quantifier. Never "shares fell sharply" — write "shares fell 12.4%". Never "several filings" — write "four filings". Every vague claim is a missed citation.
- Attribute each substantive claim to its PRIMARY SOURCE by name (FCA, SEC EDGAR, Companies House, the specific filing or register entry) — not "reports suggest". Name the document.
- Include a NAMED, ATTRIBUTABLE QUOTE where one exists in the source material (a regulator statement, a disclosed remark, a filing note). Named quotes outperform paraphrase.
- Write in clear, fluent prose for a skeptical professional reader. No keyword padding, no jargon for its own sake.
This is not stylistic preference: quotes, specific statistics, and named primary citations are the three things generative answer-engines reward most, and they are exactly what makes the brief credible to a human editor. The same evidence serves both readers.

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
        // claude-sonnet-4-20250514 was retired and started returning
        // not_found_error. Overridable via env so a future retirement can be
        // fixed without a redeploy.
        model: process.env.ANTHROPIC_BRIEF_MODEL || 'claude-sonnet-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(40000),
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `Anthropic API error: ${err}` }, { status: 500 })
    }

    const data = await res.json()
    // Take the first TEXT block, not content[0]. Newer models can return other
    // block types (e.g. thinking) first, which made content[0].text undefined
    // and produced an empty brief with a 200 response.
    type ContentBlock = { type?: string; text?: string }
    const brief = (data.content as ContentBlock[] | undefined)
      ?.filter(b => b?.type === 'text' && typeof b.text === 'string')
      .map(b => b.text as string)
      .join('\n')
      .trim() ?? ''

    if (!brief) {
      return NextResponse.json({
        error: `Model returned no text. stop_reason=${data.stop_reason ?? 'unknown'}, blocks=${(data.content ?? []).map((b: ContentBlock) => b?.type).join(',') || 'none'}`,
      }, { status: 500 })
    }

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
