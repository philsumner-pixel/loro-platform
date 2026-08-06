import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Ticker data, served from Loro's own ECB ingest.
//
// The strip previously called api.frankfurter.app from the browser and was
// failing, showing "Rate data unavailable" on every page. Since we now ingest
// the ECB Data Portal daily, the numbers can come from our own pipeline
// instead — which removes a third-party dependency on the most visible element
// of the site, and means the strip is showing data we can actually attribute.

export const runtime = 'nodejs'
export const revalidate = 300

interface Row {
  raw_content: {
    series?: string
    value?: number
    previous?: number | null
    unit?: string
    period?: string
  }
}

// Display order and short labels for the strip.
const DISPLAY: Array<{ match: string; label: string; unit: string; dp: number }> = [
  { match: 'Euro / pound sterling', label: 'EUR/GBP', unit: '', dp: 4 },
  { match: 'Euro / US dollar',      label: 'EUR/USD', unit: '', dp: 4 },
  { match: 'main refinancing',      label: 'ECB refi', unit: '%', dp: 2 },
  { match: 'deposit facility',      label: 'ECB deposit', unit: '%', dp: 2 },
  { match: 'inflation',             label: 'Euro area HICP', unit: '%', dp: 1 },
  { match: 'unemployment',          label: 'Euro area unemployment', unit: '%', dp: 1 },
]

export async function GET() {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data } = await sb
      .from('loro_source_events')
      .select('raw_content')
      .eq('source', 'ecb_data')
      .order('event_date', { ascending: false })
      .limit(40)

    const rows = (data ?? []) as Row[]

    // Most recent observation per series.
    const latest = new Map<string, Row['raw_content']>()
    for (const r of rows) {
      const s = r.raw_content?.series
      if (s && !latest.has(s)) latest.set(s, r.raw_content)
    }

    const items = DISPLAY.map(d => {
      const entry = [...latest.entries()].find(([series]) =>
        series.toLowerCase().includes(d.match.toLowerCase()))
      if (!entry) return null
      const rc = entry[1]
      const value = Number(rc.value)
      if (!Number.isFinite(value)) return null
      const prev = typeof rc.previous === 'number' ? rc.previous : null

      return {
        label: d.label,
        value: value.toFixed(d.dp),
        unit: d.unit,
        change: prev !== null ? Number((value - prev).toFixed(d.dp)) : 0,
        direction: prev === null || value === prev ? 'flat' : value > prev ? 'up' : 'down',
        period: rc.period ?? null,
      }
    }).filter(Boolean)

    return NextResponse.json(
      { items, source: 'European Central Bank Data Portal' },
      { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=1800' } }
    )
  } catch {
    return NextResponse.json({ items: [], error: true })
  }
}
