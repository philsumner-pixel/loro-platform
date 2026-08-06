import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Live source registry for the Signal Core visualisation.
//
// The visual originally carried a hardcoded copy of the registry, which went
// stale the moment a source was added — it listed ten sources and still named
// sec_edgar rather than sec_daily_index. This serves the real thing so the map
// updates as sources are connected, with no edit to the page.

export const runtime = 'nodejs'
export const revalidate = 120

const LANE_CODE: Record<string, string> = {
  'ownership-control': 'own',
  'regulation-enforcement': 'own',
  'money-markets': 'mny',
  'policy-politics': 'pol',
  'energy-sustainability': 'enr',
  'technology-infrastructure': 'tec',
}

export async function GET() {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data, error } = await sb.rpc('loro_source_health')
    if (error) throw error

    interface H {
      slug: string; label: string; publisher: string | null
      lane_slug: string | null; jurisdiction: string | null
      licence: string | null; description: string | null
      status: string; events_7d: number; events_total: number
    }

    const sources = ((data ?? []) as H[])
      // Paused sources are shown on /sources for honesty, but the map is about
      // what is currently feeding the engine.
      .filter(h => h.status !== 'paused')
      .map(h => ({
        slug: h.slug,
        label: h.label,
        pub: h.publisher ?? 'Unknown',
        lane: h.lane_slug ? LANE_CODE[h.lane_slug] ?? 'own' : 'nws',
        evwk: Number(h.events_7d ?? 0),
        total: Number(h.events_total ?? 0),
        jur: h.jurisdiction ?? 'Global',
        lic: h.licence ?? '',
        desc: h.description ?? '',
        status: h.status,
      }))

    return NextResponse.json(
      { sources, generated_at: new Date().toISOString() },
      { headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=600' } }
    )
  } catch {
    // The visual keeps its built-in fallback list, so a failure here degrades
    // to a slightly stale map rather than an empty screen.
    return NextResponse.json({ sources: [], error: true }, { status: 200 })
  }
}
