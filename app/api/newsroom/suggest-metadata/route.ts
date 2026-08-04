import { NextRequest, NextResponse } from 'next/server'

// Suggests search metadata and the agentic-search answer block from the draft.
//
// Everything returned is a SUGGESTION — the editor populates the fields and the
// journalist edits or discards. Nothing is written to the database here, and
// nothing publishes without a human. Suggestions are grounded strictly in the
// supplied draft: the prompt forbids inventing figures, because a fabricated
// number in a key fact would be worse than no key fact at all.

export const runtime = 'nodejs'
export const maxDuration = 45

interface Suggestion {
  seo_title: string
  seo_description: string
  seo_keywords: string[]
  answer_summary: string
  key_facts: Array<{ label: string; value: string }>
  faq: Array<{ question: string; answer: string }>
}

const SYSTEM = `You write search and answer-engine metadata for Loro, a business
and regulatory intelligence publication that derives stories from primary
documents (SEC filings, Companies House records, FCA disclosures).

Return ONLY valid JSON. No preamble, no markdown fences.

Rules:
- Use ONLY facts present in the supplied draft. Never invent a figure, date,
  company name or source. If the draft doesn't contain a number, don't produce
  one. An empty array is always better than a fabricated entry.
- seo_title: max 60 chars. Phrase it as the QUESTION a professional would
  actually type or ask, not the display headline's flourish.
- seo_description: max 155 chars, specific and factual.
- seo_keywords: 4-8 terms, lowercase, no hashtags.
- answer_summary: 1-2 sentences that directly answer what the article is about.
  Written to be quoted verbatim. Lead with the specific fact, not context.
- key_facts: 2-5 discrete checkable facts as {label, value}. Values must carry
  the specific figure, date or name from the draft. Omit anything vague.
- faq: 2-3 {question, answer} pairs a reader would genuinely ask. Answers one
  or two sentences, drawn from the draft only.

Schema:
{"seo_title":"","seo_description":"","seo_keywords":[],"answer_summary":"",
 "key_facts":[{"label":"","value":""}],"faq":[{"question":"","answer":""}]}`

function stripHtml(html: string): string {
  return html
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const { headline, standfirst, body_html } = await req.json()
  if (!headline || !body_html) {
    return NextResponse.json({ error: 'headline and body_html required' }, { status: 400 })
  }

  const body = stripHtml(String(body_html)).slice(0, 6000)
  const prompt = `HEADLINE: ${headline}
STANDFIRST: ${standfirst ?? ''}

ARTICLE:
${body}`

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
        max_tokens: 1500,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(40000),
    })

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200)
      return NextResponse.json({ error: `Anthropic ${res.status}: ${detail}` }, { status: 500 })
    }

    const data = await res.json()
    type Block = { type?: string; text?: string }
    const text = ((data.content ?? []) as Block[])
      .filter(b => b?.type === 'text' && typeof b.text === 'string')
      .map(b => b.text as string)
      .join('')
      .trim()

    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

    let parsed: Suggestion
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      return NextResponse.json(
        { error: 'Model did not return valid JSON', raw: cleaned.slice(0, 300) },
        { status: 502 }
      )
    }

    // Trim to the documented limits rather than trusting the model.
    return NextResponse.json({
      seo_title: (parsed.seo_title ?? '').slice(0, 60),
      seo_description: (parsed.seo_description ?? '').slice(0, 155),
      seo_keywords: (parsed.seo_keywords ?? []).slice(0, 8),
      answer_summary: parsed.answer_summary ?? '',
      key_facts: (parsed.key_facts ?? []).filter(f => f?.label && f?.value).slice(0, 5),
      faq: (parsed.faq ?? []).filter(f => f?.question && f?.answer).slice(0, 3),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Suggestion failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
