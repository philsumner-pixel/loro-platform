import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun } from '@/lib/ingest/utils'

// ── ECB DATA PORTAL ─────────────────────────────────────────────────────
// Fills Money & Markets, the last empty lane. The previous BIS/ECB route died
// with HTTP 406 — an SDMX content-negotiation failure, not a dead endpoint:
// these services return XML unless you ask for JSON explicitly, and the old
// route did not.
//
// Free, no key. Series chosen because a MOVE in them is a story: policy rates,
// euro-area inflation, unemployment, and the reference exchange rates that
// everything else in payments is priced against.
//
// Telemetry alone is not news, so this ingests only the latest observation per
// series and flags a material change against the previous one.
//
// ?probe=1 returns the upstream shape without writing.

export const runtime = 'nodejs'
export const maxDuration = 60

const BASE = 'https://data-api.ecb.europa.eu/service/data'
const UA = 'Loro Intelligence (contact: hello@loro.media)'

interface SeriesDef {
  key: string          // SDMX flowRef/seriesKey
  label: string
  unit: string
  moveThreshold: number // absolute change that counts as notable
}

const SERIES: SeriesDef[] = [
  { key: 'FM/D.U2.EUR.4F.KR.MRR_FR.LEV', label: 'ECB main refinancing rate', unit: '%', moveThreshold: 0.01 },
  { key: 'FM/D.U2.EUR.4F.KR.DFR.LEV',    label: 'ECB deposit facility rate', unit: '%', moveThreshold: 0.01 },
  { key: 'ICP/M.U2.N.000000.4.ANR',      label: 'Euro area inflation (HICP, annual)', unit: '%', moveThreshold: 0.2 },
  { key: 'LFSI/M.I9.S.UNEHRT.TOTAL0.15_74.T', label: 'Euro area unemployment rate', unit: '%', moveThreshold: 0.1 },
  { key: 'EXR/D.GBP.EUR.SP00.A',         label: 'Euro / pound sterling reference rate', unit: 'GBP per EUR', moveThreshold: 0.01 },
  { key: 'EXR/D.USD.EUR.SP00.A',         label: 'Euro / US dollar reference rate', unit: 'USD per EUR', moveThreshold: 0.01 },
]

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Fetch a series as JSON. The 406 that killed the old route came from not
 * negotiating content type — both the Accept header and format param are sent
 * so either mechanism satisfies the service.
 */
async function fetchSeries(key: string, lastN: number): Promise<unknown> {
  const url = `${BASE}/${key}?lastNObservations=${lastN}&format=jsondata`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`${res.status} ${key}`)
  return res.json()
}

/** SDMX-JSON nests observations under structure indices — pull (date, value). */
function extractObservations(payload: unknown): Array<{ period: string; value: number }> {
  const p = payload as {
    dataSets?: Array<{ series?: Record<string, { observations?: Record<string, unknown[]> }> }>
    structure?: {
      dimensions?: {
        observation?: Array<{ values?: Array<{ id?: string; name?: string }> }>
      }
    }
  }

  const periods = p.structure?.dimensions?.observation?.[0]?.values ?? []
  const series = p.dataSets?.[0]?.series ?? {}
  const first = Object.values(series)[0]
  if (!first?.observations) return []

  const out: Array<{ period: string; value: number }> = []
  for (const [idx, arr] of Object.entries(first.observations)) {
    const value = Array.isArray(arr) ? Number(arr[0]) : NaN
    const period = periods[Number(idx)]?.id ?? periods[Number(idx)]?.name
    if (period && Number.isFinite(value)) out.push({ period, value })
  }
  return out.sort((a, b) => a.period.localeCompare(b.period))
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const probe = url.searchParams.get('probe') === '1'

  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!probe && cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (probe) {
    const out: Array<Record<string, unknown>> = []
    for (const s of SERIES.slice(0, 3)) {
      try {
        const raw = await fetchSeries(s.key, 3)
        out.push({ series: s.label, key: s.key, observations: extractObservations(raw) })
      } catch (e) {
        out.push({ series: s.label, key: s.key, error: e instanceof Error ? e.message : 'failed' })
      }
    }
    return NextResponse.json({ probe: true, results: out })
  }

  const runId = await startRun('ecb_data')
  const sb = getSupabase()
  const errors: string[] = []
  const rows: Array<Record<string, unknown>> = []
  let found = 0, inserted = 0, dupes = 0

  try {
    for (const s of SERIES) {
      try {
        const obs = extractObservations(await fetchSeries(s.key, 6))
        if (!obs.length) { errors.push(`${s.label}: no observations`); continue }
        found++

        const latest = obs[obs.length - 1]
        const prev = obs.length > 1 ? obs[obs.length - 2] : null
        const change = prev ? latest.value - prev.value : 0
        const notable = prev ? Math.abs(change) >= s.moveThreshold : false

        const direction = change > 0 ? 'rose' : change < 0 ? 'fell' : 'was unchanged'
        const fmt = (n: number) => Number(n.toFixed(4)).toString()

        rows.push({
          source: 'ecb_data',
          event_type: notable ? 'market_indicator_move' : 'market_indicator_update',
          event_date: latest.period.length === 7 ? `${latest.period}-01` : latest.period,
          url: `https://data.ecb.europa.eu/data/datasets/${s.key.split('/')[0]}`,
          raw_content: {
            title: notable
              ? `${s.label} ${direction} to ${fmt(latest.value)}${s.unit === '%' ? '%' : ` ${s.unit}`}`
              : `${s.label}: ${fmt(latest.value)}${s.unit === '%' ? '%' : ` ${s.unit}`}`,
            description:
              `The ${s.label} stood at ${fmt(latest.value)} ${s.unit} for ${latest.period}` +
              (prev
                ? `, having been ${fmt(prev.value)} in ${prev.period} — a change of ${change > 0 ? '+' : ''}${fmt(change)}.`
                : '.') +
              (notable ? ' This is a material move against the preceding observation.' : ''),
            series: s.label,
            value: latest.value,
            previous: prev?.value ?? null,
            change,
            unit: s.unit,
            period: latest.period,
            notable,
          },
          source_metadata: {
            series_key: s.key,
            period: latest.period,
            value: latest.value,
            change,
            notable,
            attribution: 'Source: European Central Bank Data Portal',
          },
          processed: false,
        })
      } catch (e) {
        errors.push(`${s.label}: ${e instanceof Error ? e.message.slice(0, 70) : 'failed'}`)
      }
    }

    if (rows.length) {
      // One observation per series per period — key on both.
      const keys = rows.map(r =>
        `${(r.source_metadata as Record<string, unknown>).series_key}@${(r.source_metadata as Record<string, unknown>).period}`)

      const { data: seen } = await sb
        .from('loro_source_events')
        .select('source_metadata')
        .eq('source', 'ecb_data')
        .limit(2000)

      const seenSet = new Set(
        (seen ?? []).map(x => {
          const m = x.source_metadata as Record<string, unknown>
          return `${m?.series_key}@${m?.period}`
        })
      )

      const fresh = rows.filter((_, i) => !seenSet.has(keys[i]))
      dupes = rows.length - fresh.length

      if (fresh.length) {
        const { data: ins, error } = await sb
          .from('loro_source_events').insert(fresh).select('id')
        if (error) errors.push(`insert: ${error.message}`)
        inserted = ins?.length ?? 0
      }
    }

    await completeRun(runId, { found, new: inserted, duplicate: dupes }, errors)
    return NextResponse.json({ ok: true, series_fetched: found, inserted, duplicates: dupes, errors: errors.slice(0, 4) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await completeRun(runId, { found, new: inserted, duplicate: dupes }, [msg])
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
