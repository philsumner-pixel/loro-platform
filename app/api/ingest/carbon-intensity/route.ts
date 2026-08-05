import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun } from '@/lib/ingest/utils'

// ── GB CARBON INTENSITY & GENERATION MIX ────────────────────────────────
// Fills Energy & Sustainability, the last empty lane.
//
// National Grid ESO's official carbon intensity API: free, no key, Open
// Government Licence. Half-hourly carbon intensity plus the generation mix
// (wind, solar, nuclear, gas, coal, imports, biomass, hydro).
//
// Telemetry on its own is not news, so this ingests DAILY SUMMARIES rather
// than every half-hour reading, and flags the things that actually are
// stories: a record low or high, coal or gas hitting an extreme, renewables
// crossing a threshold. It also feeds the datapoint library agreed with
// Chris — cited figures rendered in Loro's own charts.
//
// ?probe=1 returns the upstream shape without writing.

export const runtime = 'nodejs'
export const maxDuration = 60

const BASE = 'https://api.carbonintensity.org.uk'
const UA = 'Loro Intelligence (contact: hello@loro.media)'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface IntensityPoint {
  from?: string
  to?: string
  intensity?: { forecast?: number; actual?: number; index?: string }
}
interface MixPoint {
  from?: string
  to?: string
  generationmix?: Array<{ fuel?: string; perc?: number }>
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

function dayRange(daysAgo: number): { from: string; to: string; label: string } {
  const d = new Date(Date.now() - daysAgo * 86400_000)
  const day = d.toISOString().slice(0, 10)
  return { from: `${day}T00:00Z`, to: `${day}T23:59Z`, label: day }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const probe = url.searchParams.get('probe') === '1'
  const days = Math.min(Number(url.searchParams.get('days') ?? 3), 14)

  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!probe && cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (probe) {
    const r = dayRange(1)
    try {
      const [intensity, mix] = await Promise.all([
        getJson(`${BASE}/intensity/${r.from}/${r.to}`),
        getJson(`${BASE}/generation/${r.from}/${r.to}`),
      ])
      const iData = (intensity as { data?: IntensityPoint[] }).data ?? []
      const mData = (mix as { data?: MixPoint[] }).data ?? []
      return NextResponse.json({
        probe: true, day: r.label,
        intensity_points: iData.length,
        intensity_sample: iData[0] ?? null,
        mix_points: mData.length,
        mix_sample: mData[0] ?? null,
      })
    } catch (e) {
      return NextResponse.json({ probe: true, error: e instanceof Error ? e.message : 'failed' })
    }
  }

  const runId = await startRun('carbon_intensity')
  const sb = getSupabase()
  const errors: string[] = []
  const rows: Array<Record<string, unknown>> = []
  let found = 0, inserted = 0, dupes = 0

  try {
    for (let d = 1; d <= days; d++) {
      const r = dayRange(d)
      try {
        const [intensity, mix] = await Promise.all([
          getJson(`${BASE}/intensity/${r.from}/${r.to}`),
          getJson(`${BASE}/generation/${r.from}/${r.to}`),
        ])

        const iPoints = ((intensity as { data?: IntensityPoint[] }).data ?? [])
          .map(p => p.intensity?.actual ?? p.intensity?.forecast)
          .filter((n): n is number => typeof n === 'number')

        if (!iPoints.length) continue
        found++

        const avg = Math.round(iPoints.reduce((a, b) => a + b, 0) / iPoints.length)
        const min = Math.min(...iPoints)
        const max = Math.max(...iPoints)

        // Average the generation mix across the day.
        const mPoints = (mix as { data?: MixPoint[] }).data ?? []
        const fuelTotals: Record<string, number> = {}
        for (const p of mPoints) {
          for (const g of p.generationmix ?? []) {
            if (!g.fuel || typeof g.perc !== 'number') continue
            fuelTotals[g.fuel] = (fuelTotals[g.fuel] ?? 0) + g.perc
          }
        }
        const n = Math.max(mPoints.length, 1)
        const mixAvg = Object.fromEntries(
          Object.entries(fuelTotals).map(([f, t]) => [f, Math.round((t / n) * 10) / 10])
        )

        const renewables =
          (mixAvg.wind ?? 0) + (mixAvg.solar ?? 0) + (mixAvg.hydro ?? 0) + (mixAvg.biomass ?? 0)
        const fossil = (mixAvg.gas ?? 0) + (mixAvg.coal ?? 0)

        // What makes it a story rather than telemetry.
        const flags: string[] = []
        if (avg < 50) flags.push('very low carbon intensity')
        if (avg > 250) flags.push('very high carbon intensity')
        if (renewables > 70) flags.push('renewables above 70%')
        if ((mixAvg.coal ?? 0) > 1) flags.push('measurable coal generation')
        if (fossil < 10) flags.push('fossil generation below 10%')

        rows.push({
          source: 'carbon_intensity',
          event_type: flags.length ? 'grid_notable_day' : 'grid_daily_summary',
          event_date: r.label,
          url: `https://carbonintensity.org.uk/#${r.label}`,
          raw_content: {
            title: flags.length
              ? `GB grid, ${r.label}: ${flags[0]} (${avg} gCO2/kWh, renewables ${renewables.toFixed(1)}%)`
              : `GB grid carbon intensity ${r.label}: ${avg} gCO2/kWh average`,
            description:
              `Great Britain's electricity grid averaged ${avg} gCO2/kWh on ${r.label}, ranging from ${min} to ${max}. ` +
              `Generation mix: ${Object.entries(mixAvg)
                .sort((a, b) => b[1] - a[1])
                .map(([f, p]) => `${f} ${p}%`)
                .join(', ')}. Renewables totalled ${renewables.toFixed(1)}% and fossil fuels ${fossil.toFixed(1)}%.` +
              (flags.length ? ` Notable: ${flags.join('; ')}.` : ''),
            avg_intensity: avg, min_intensity: min, max_intensity: max,
            generation_mix: mixAvg,
            renewables_pct: Math.round(renewables * 10) / 10,
            fossil_pct: Math.round(fossil * 10) / 10,
            flags,
          },
          source_metadata: {
            day: r.label, avg_intensity: avg, renewables_pct: renewables,
            flags,
            attribution: 'Carbon Intensity data from National Grid ESO, Open Government Licence',
          },
          processed: false,
        })
      } catch (e) {
        errors.push(`${r.label}: ${e instanceof Error ? e.message.slice(0, 60) : 'failed'}`)
      }
    }

    if (rows.length) {
      const urls = rows.map(r => r.url as string)
      const { data: seen } = await sb
        .from('loro_source_events')
        .select('url').eq('source', 'carbon_intensity').in('url', urls)
      const seenSet = new Set((seen ?? []).map(s => s.url as string))
      const fresh = rows.filter(r => !seenSet.has(r.url as string))
      dupes = rows.length - fresh.length

      if (fresh.length) {
        const { data: ins, error } = await sb
          .from('loro_source_events').insert(fresh).select('id')
        if (error) errors.push(`insert: ${error.message}`)
        inserted = ins?.length ?? 0
      }
    }

    await completeRun(runId, { found, new: inserted, duplicate: dupes }, errors)
    return NextResponse.json({ ok: true, days_fetched: found, inserted, duplicates: dupes, errors: errors.slice(0, 3) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await completeRun(runId, { found, new: inserted, duplicate: dupes }, [msg])
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
