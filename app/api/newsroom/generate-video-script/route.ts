import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { LORO_DEFAULT_VOICE, type LoroVideoScript } from '@/lib/loro-video'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

function num(v: unknown, dp = 1): string | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(dp) : null
}

export async function POST(req: NextRequest) {
  const { digest_id } = await req.json()
  if (!digest_id) return NextResponse.json({ error: 'digest_id required' }, { status: 400 })

  // 1. Pull the digest (the inbox item)
  const { data: d } = await sb()
    .from('loro_signal_digests')
    .select('*')
    .eq('id', digest_id)
    .single()

  if (!d) return NextResponse.json({ error: 'Digest not found' }, { status: 404 })

  // 2. Enrich with the entity's live sub-scores + 7-day signal counts
  let enrich = ''
  if (d.entity_id) {
    const { data: s } = await sb()
      .from('loro_entity_scores_latest')
      .select('*')
      .eq('entity_id', d.entity_id)
      .single()
    if (s) {
      const lines: string[] = []
      const push = (label: string, v: string | null) => { if (v != null) lines.push(`- ${label}: ${v}`) }
      push('Loro Score', num(s.loro_score))
      push('Score percentile', num(s.score_percentile, 0))
      push('Regulatory sub-score', num(s.regulatory_score))
      push('Sentiment sub-score', num(s.sentiment_score))
      push('News sub-score', num(s.news_score))
      push('Regulatory events (7d)', num(s.regulatory_events_7d, 0))
      push('News articles (7d)', num(s.news_articles_7d, 0))
      push('Net sentiment (7d)', num(s.sentiment_net_7d))
      push('PDMR events (7d)', num(s.pdmr_events_7d, 0))
      if (s.insider_direction) lines.push(`- Insider direction: ${s.insider_direction}`)
      if (s.alert_reason) lines.push(`- Alert reason: ${s.alert_reason}`)
      if (lines.length) enrich = `\n\nLive entity metrics:\n${lines.join('\n')}`
    }
  }

  const delta = d.score_delta != null
    ? `${Number(d.score_delta) > 0 ? '+' : ''}${Number(d.score_delta).toFixed(1)} points`
    : ''
  const scoreContext = d.score_before != null
    ? `Loro Score moved from ${Number(d.score_before).toFixed(1)} to ${Number(d.score_after).toFixed(1)} (${delta}).`
    : ''
  const storyContext = d.generated_story ? `\n\nFull signal digest:\n${d.generated_story}` : ''

  const prompt = `You are a video script editor for Loro Payment Intelligence, an independent payments intelligence publication. You write SHORT-FORM social videos (~60 seconds) in a single-reveal format: one entity, the data, and what to watch. Think a sharp, digestible 60-second news story — not a countdown.

Write a script from this signal.

Entity: ${d.entity_name}
Signal type: ${String(d.trigger_type).replace(/_/g, ' ')}
${scoreContext}
Summary: ${d.trigger_summary}${enrich}${storyContext}

Return ONLY a valid JSON object, no markdown, no backticks, no preamble, matching EXACTLY this shape:
{
  "hook": "one punchy opening line that earns the next 5 seconds — lead with the most surprising number or movement, no clickbait words",
  "headline": "${d.entity_name}",
  "data_points": [
    {"label": "short stat label", "value": "the number", "delta": "optional change e.g. -17.5"}
  ],
  "context": "one sentence explaining what actually happened",
  "what_to_watch": "one sentence on what to watch next",
  "cta": "Follow Loro for payments intelligence.",
  "narration": "the full spoken voiceover as one flowing block: hook, then the data spoken naturally, then context, then what to watch, then the CTA. 110-140 words. Spoken English, no on-screen labels, no markdown.",
  "broll_keywords": ["3 to 5 concrete Pexels search terms for neutral fintech/payments background footage"]
}

Rules: factual, data-led, written for investors and payments professionals. Use 2-4 data_points, each carrying a real number from the data above. No hype words ("shocking", "breaking", "you won't believe"). Never invent numbers — only use figures present above.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await res.json()
    const raw: string = data.content?.[0]?.text ?? ''
    const clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim()

    let script: LoroVideoScript
    try {
      script = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'Script generation returned invalid JSON', raw }, { status: 502 })
    }

    if (!script.narration || !script.hook) {
      return NextResponse.json({ error: 'Script incomplete' }, { status: 502 })
    }

    // 3. Create the suggested video row (or refresh an existing un-rendered one)
    const { data: existing } = await sb()
      .from('loro_videos')
      .select('id, status')
      .eq('digest_id', digest_id)
      .in('status', ['suggested', 'script_ready'])
      .maybeSingle()

    let row
    if (existing) {
      const { data: upd } = await sb()
        .from('loro_videos')
        .update({ script, status: 'suggested', script_edited_at: null })
        .eq('id', existing.id)
        .select('*')
        .single()
      row = upd
    } else {
      const { data: ins } = await sb()
        .from('loro_videos')
        .insert({
          digest_id,
          entity_id: d.entity_id ?? null,
          entity_name: d.entity_name ?? null,
          script,
          voice_persona: LORO_DEFAULT_VOICE,
          status: 'suggested',
          created_by: 'system',
        })
        .select('*')
        .single()
      row = ins
    }

    return NextResponse.json({ video: row })
  } catch (err) {
    console.error('generate-video-script error:', err)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
