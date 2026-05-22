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
  const email = body.get('email')?.toString().trim()
  const name = body.get('name')?.toString().trim() || null
  const organisation = body.get('organisation')?.toString().trim() || null

  if (!email || !email.includes('@')) {
    return NextResponse.redirect(new URL('/subscribe?error=invalid_email', req.url))
  }

  const sb = getSupabase()

  await sb.from('loro_subscribers').upsert({
    email,
    name,
    organisation,
    tier: 'free',
    subscribed_at: new Date().toISOString(),
  }, { onConflict: 'email' })

  return NextResponse.redirect(new URL('/subscribe/confirmed', req.url))
}
