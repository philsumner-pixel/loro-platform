import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Site search across three things at once, because for Loro they are one
// question: published articles, entities in the graph, and the underlying
// register records. That last one matters — a reader may want the DONATION
// itself, not an article about it, and there are thousands of records we have
// never written about.

export const runtime = 'nodejs'
export const revalidate = 60

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ results: [], query: q })

  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data, error } = await sb.rpc('loro_search', { q, max_each: 10 })
    if (error) return NextResponse.json({ results: [], error: error.message })

    interface R { kind: string; title: string; subtitle: string; url: string; meta: string }
    const results = (data ?? []) as R[]
    return NextResponse.json({
      query: q,
      results,
      counts: {
        article: results.filter(r => r.kind === 'article').length,
        entity: results.filter(r => r.kind === 'entity').length,
        record: results.filter(r => r.kind === 'record').length,
      },
    })
  } catch {
    return NextResponse.json({ results: [], error: true })
  }
}
