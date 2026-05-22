import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function POST(req: NextRequest) {
  const body = await req.formData()
  const email         = body.get('email')?.toString().trim()
  const name          = body.get('name')?.toString().trim() || null
  const organisation  = body.get('organisation')?.toString().trim() || null
  const audience_type = body.get('audience_type')?.toString() || 'unknown'
  const tier          = body.get('tier')?.toString() || 'free'
  const role          = body.get('role')?.toString() || null
  const interest_note = body.get('interest_note')?.toString() || null

  if (!email || !email.includes('@')) {
    return NextResponse.redirect(new URL('/subscribe?error=invalid_email', req.url))
  }

  const sb = getSupabase()
  await sb.from('loro_subscribers').upsert({
    email, name, organisation,
    audience_type, tier, role, interest_note,
    subscribed_at: new Date().toISOString(),
  }, { onConflict: 'email' })

  const dest = audience_type === 'b2b'
    ? '/subscribe/confirmed?track=intelligence'
    : '/subscribe/confirmed?track=weekly'

  return NextResponse.redirect(new URL(dest, req.url))
}
