import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Adjudicate whether a benefit a member received relates in SUBJECT to
// something they later voted on or said.
//
// Keywords and embeddings both failed at this: SIC describes legal
// classification rather than subject, and embeddings at this text length
// capture domain (UK parliamentary text) rather than subject. This is a
// judgement call, and it needs to come back with a REASON in words — that is
// what tells the reader why anything is flagged.
//
// The prompt is written to be conservative. In journalism a false positive is
// far more costly than a miss: flagging an unrelated donation next to a vote
// implies an allegation nobody made.

export const runtime = 'nodejs'
export const maxDuration = 60

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const SYSTEM = `You assess whether a benefit received by a UK parliamentarian is
related IN SUBJECT to something they later voted on or spoke about.

Return ONLY valid JSON: {"related": true|false, "confidence": "high"|"medium"|"low", "reason": "..."}

This supports journalism, so be CONSERVATIVE. A false positive implies an
allegation nobody made. Judge subject overlap only — never motive, never
impropriety.

Answer TRUE only where the donor's field of activity plainly bears on the
matter voted on or debated. Examples of genuine overlap: a housebuilder and a
planning bill; a gambling operator and a betting levy; an energy supplier and a
net zero measure; a union and employment rights.

Answer FALSE for:
- generic political or civic activity with no sector link
- procedural votes (adjournments, timetabling, standing orders)
- vague or unidentifiable donors
- coincidence of timing alone

"reason" must be one plain sentence a reader can check, naming what the donor
does and what the measure concerns. If related is false, say briefly why not.
Never assert or imply wrongdoing; describe the subject relationship only.`

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })

  const url = new URL(req.url)
  const person = url.searchParams.get('person')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 12), 30)

  const client = sb()
  const { data: pairs, error } = await client.rpc('loro_relevance_candidates', {
    person_name: person, max_days: 270, max_pairs: limit,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  interface P {
    person: string
    benefit_id: string; benefit_date: string; benefit_kind: string
    benefit_from: string; benefit_value: string; benefit_detail: string
    event_id: string; event_date: string; event_kind: string
    event_title: string; days_between: number
  }
  const list = (pairs ?? []) as P[]
  if (!list.length) return NextResponse.json({ ok: true, assessed: 0, message: 'No new pairs' })

  const results: Array<Record<string, unknown>> = []

  for (const p of list) {
    const benefitSummary =
      `${p.benefit_kind === 'received' ? 'Received' : 'Declared'} ` +
      `${Number(p.benefit_value) ? `£${Number(p.benefit_value).toLocaleString('en-GB')} ` : ''}` +
      `from ${p.benefit_from}${p.benefit_detail ? `. ${p.benefit_detail}` : ''}`
    const eventSummary =
      `${p.event_kind === 'voted' ? 'Voted in division' : 'Spoke in debate'}: ${p.event_title}`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_BRIEF_MODEL || 'claude-sonnet-5',
          max_tokens: 300,
          system: SYSTEM,
          messages: [{
            role: 'user',
            content: `BENEFIT (${p.benefit_date}): ${benefitSummary}\n` +
                     `LATER (${p.event_date}, ${p.days_between} days after): ${eventSummary}`,
          }],
        }),
        signal: AbortSignal.timeout(25000),
      })
      if (!res.ok) continue

      const data = await res.json()
      type Block = { type?: string; text?: string }
      const text = ((data.content ?? []) as Block[])
        .filter(b => b?.type === 'text' && b.text).map(b => b.text as string).join('').trim()
      const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

      let verdict: { related?: boolean; confidence?: string; reason?: string }
      try { verdict = JSON.parse(cleaned) } catch { continue }
      if (typeof verdict.related !== 'boolean' || !verdict.reason) continue

      await client.from('loro_relevance_assessments').upsert({
        person: p.person,
        benefit_id: p.benefit_id,
        event_id: p.event_id,
        benefit_summary: benefitSummary.slice(0, 500),
        event_summary: eventSummary.slice(0, 500),
        days_between: p.days_between,
        related: verdict.related,
        confidence: ['high','medium','low'].includes(verdict.confidence ?? '')
          ? verdict.confidence : 'low',
        reason: verdict.reason.slice(0, 600),
        model: process.env.ANTHROPIC_BRIEF_MODEL || 'claude-sonnet-5',
      }, { onConflict: 'benefit_id,event_id' })

      results.push({ person: p.person, related: verdict.related,
        confidence: verdict.confidence, reason: verdict.reason })
    } catch { /* skip this pair */ }
  }

  return NextResponse.json({
    ok: true,
    assessed: results.length,
    related: results.filter(r => r.related).length,
    results: results.slice(0, 12),
  })
}

// Read assessments for the dossier.
export async function GET(req: Request) {
  const person = new URL(req.url).searchParams.get('person')
  try {
    let q = sb().from('loro_relevance_assessments')
      .select('person, benefit_id, event_id, benefit_summary, event_summary, days_between, related, confidence, reason')
      .eq('related', true)
      .order('days_between', { ascending: true })
      .limit(100)
    if (person) {
      q = q.eq('person', person.toLowerCase()
        .replace(/^(mr|mrs|ms|miss|dr|sir|lord|lady|the rt hon|rt hon)\s+/i, ''))
    }
    const { data } = await q
    return NextResponse.json({ assessments: data ?? [] })
  } catch {
    return NextResponse.json({ assessments: [], error: true })
  }
}
