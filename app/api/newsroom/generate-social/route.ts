import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function POST(req: NextRequest) {
  const { digest_id } = await req.json()
  if (!digest_id) return NextResponse.json({ error: 'digest_id required' }, { status: 400 })

  const { data: d } = await sb()
    .from('loro_signal_digests')
    .select('*')
    .eq('id', digest_id)
    .single()

  if (!d) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const delta = d.score_delta != null
    ? `${d.score_delta > 0 ? '+' : ''}${Number(d.score_delta).toFixed(1)} points`
    : ''

  const scoreContext = d.score_before != null
    ? `Score moved from ${Number(d.score_before).toFixed(1)} to ${Number(d.score_after).toFixed(1)} (${delta}).`
    : ''

  const storyContext = d.generated_story
    ? `\n\nFull signal digest:\n${d.generated_story}`
    : ''

  const prompt = `You are a social media editor for Loro Payment Intelligence, an independent payments intelligence publication.

Generate two social media posts from this signal data.

Entity: ${d.entity_name}
Signal type: ${d.trigger_type.replace(/_/g, ' ')}
${scoreContext}
Summary: ${d.trigger_summary}${storyContext}

Produce EXACTLY this output format — two sections separated by ---:

LINKEDIN:
[A 150-180 word LinkedIn post. Professional tone. Lead with the data insight, not a question. Use short paragraphs. Include 2-3 specific numbers from the data. End with one clear CTA sentence pointing to Loro Payment Intelligence. Add 3-4 relevant hashtags on the final line: #payments #fintech #paymentsintelligence plus one specific one.]

---

TWITTER:
[A 4-tweet thread. Each tweet on its own line, prefixed with the tweet number like "1/" "2/" "3/" "4/". First tweet is the hook with the key number — must stand alone. Second tweet is the data context. Third tweet is what to watch. Fourth tweet is the CTA with a link placeholder [loro-platform.vercel.app]. Keep each tweet under 240 characters. No hashtags except on tweet 4.]

Rules: factual, data-led, no hype words like "shocking" or "breaking". Write for investors and payments professionals. Never use the phrase "In the world of".`

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
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await res.json()
    const raw = data.content?.[0]?.text ?? ''

    // Split on --- separator
    const parts = raw.split(/\n---\n/)
    const linkedin = parts[0]?.replace(/^LINKEDIN:\n?/, '').trim() ?? ''
    const twitter  = parts[1]?.replace(/^TWITTER:\n?/, '').trim() ?? ''

    if (!linkedin || !twitter) {
      return NextResponse.json({ error: 'Generation incomplete' }, { status: 500 })
    }

    await sb()
      .from('loro_signal_digests')
      .update({
        social_linkedin: linkedin,
        social_twitter: twitter,
        social_generated_at: new Date().toISOString(),
      })
      .eq('id', digest_id)

    return NextResponse.json({ linkedin, twitter })
  } catch (err) {
    console.error('generate-social error:', err)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
