import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Inbox auto-expiry, on a schedule.
 *
 * Expiry used to run only as a side effect of loading the inbox, with its error
 * unchecked. It failed on every call for a month (two overloads of the RPC, so
 * PostgREST returned PGRST203) and nobody could tell, because a side effect that
 * fails silently looks exactly like one that succeeds. Running it on a cron
 * means it has somewhere to report to.
 */
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  // Vercel cron requests carry this header; reject anything else so the endpoint
  // cannot be used to force expiry from outside.
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const sb = getSupabase()

  const { data, error } = await sb.rpc('loro_expire_stale_candidates', {
    days_old: 7,
    shortlist_days_old: 21,
  })

  if (error) {
    console.error('[cron/expire] failed', { code: error.code, message: error.message })
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 })
  }

  console.log(`[cron/expire] expired ${data ?? 0} candidates`)
  return NextResponse.json({ expired: data ?? 0, at: new Date().toISOString() })
}
