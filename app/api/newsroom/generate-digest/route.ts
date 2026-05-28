import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function POST(req: NextRequest) {
  const { digest_id } = await req.json()
  if (!digest_id) return NextResponse.json({ error: 'digest_id required' }, { status: 400 })

  const sb = getSupabase()
  const { data: digest } = await sb
    .from('loro_signal_digests')
    .select('*')
    .eq('id', digest_id)
    .single()

  if (!digest) return NextResponse.json({ error: 'Digest not found' }, { status: 404 })

  const prompt = `You are a financial journalist writing for Loro Payment Intelligence.
Generate a concise signal digest story (150-200 words) based on this data insight.

Entity: ${digest.entity_name}
Trigger type: ${digest.trigger_type}
${digest.score_before != null ? `Score movement: ${digest.score_before} -> ${digest.score_after} (${digest.score_delta > 0 ? '+' : ''}${digest.score_delta} points)` : ''}
Summary: ${digest.trigger_summary}

Format EXACTLY as:
SIGNAL: [one-line headline]

[2-3 sentence explanation of what happened and why it matters]

THE DATA:
- [key metric 1]
- [key metric 2]
- [key metric 3]

WHAT TO WATCH: [1-2 sentences on what a journalist should monitor next]

Keep it data-led, factual, and tight. No speculation beyond the data. Write for a professional investor or journalist audience.`

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
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await res.json()
    const story = data.content?.[0]?.text

    if (!story) return NextResponse.json({ error: 'Generation failed' }, { status: 500 })

    await sb.from('loro_signal_digests')
      .update({ generated_story: story, generated_at: new Date().toISOString() })
      .eq('id', digest_id)

    return NextResponse.json({ story })
  } catch (err) {
    console.error('generate-digest error:', err)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const { digest_id, status } = await req.json()
  if (!digest_id || !status) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const sb = getSupabase()
  const update: Record<string, string> = { status }
  if (status === 'approved') update.approved_at = new Date().toISOString()

  await sb.from('loro_signal_digests').update(update).eq('id', digest_id)
  return NextResponse.json({ ok: true })
}

export async function GET() {
  const sb = getSupabase()
  const { data } = await sb
    .from('loro_signal_digests')
    .select('*')
    .order('triggered_at', { ascending: false })
    .limit(50)
  return NextResponse.json({ digests: data ?? [] })
}
