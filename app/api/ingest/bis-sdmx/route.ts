import { NextResponse } from 'next/server'
import { getSupabase, startRun, completeRun, writeSourceEvent } from '@/lib/ingest/utils'

// BIS SDMX API: https://stats.bis.org/api/v1/
// ECB SDMX API: https://sdw-wsrest.ecb.europa.eu/service/
// Both use the same SDMX REST standard — no API key required

export const runtime = 'nodejs'
export const maxDuration = 60

// SDMX query builder
function sdmxUrl(
  base: string,
  dataflow: string,
  key: string,
  params: Record<string, string> = {}
): string {
  const qs = new URLSearchParams({
    format: 'jsondata',
    detail: 'dataonly',
    ...params,
  })
  return `${base}/data/${dataflow}/${key}?${qs}`
}

// Get last N periods in SDMX period format (Q for quarterly, M for monthly)
function lastPeriods(n: number, freq: 'Q' | 'M'): { startPeriod: string; endPeriod: string } {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  if (freq === 'Q') {
    const q = Math.ceil(month / 3)
    // Go back n quarters
    let startQ = q - n
    let startY = year
    while (startQ <= 0) { startQ += 4; startY-- }
    return {
      startPeriod: `${startY}-Q${startQ}`,
      endPeriod: `${year}-Q${q}`,
    }
  } else {
    const startM = month - n
    const startY = startM <= 0 ? year - 1 : year
    const adjStartM = startM <= 0 ? 12 + startM : startM
    return {
      startPeriod: `${startY}-${String(adjStartM).padStart(2, '0')}`,
      endPeriod: `${year}-${String(month).padStart(2, '0')}`,
    }
  }
}

async function fetchSdmx(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Loro-Intelligence-Bot/1.0' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`SDMX fetch failed: ${res.status} ${url}`)
  return res.json()
}

// Extract series values from SDMX JSON response
function extractSeries(data: Record<string, unknown>): Array<{ key: string; period: string; value: string }> {
  const results: Array<{ key: string; period: string; value: string }> = []
  try {
    const ds = (data as { dataSets?: Array<{ series?: Record<string, { observations?: Record<string, [string]> }> }> })
      .dataSets?.[0]?.series ?? {}
    const structure = (data as { structure?: { dimensions?: { series?: Array<{ values: Array<{ id: string }> }>; observation?: Array<{ values: Array<{ id: string }> }> } } }).structure
    const obsDims = structure?.dimensions?.observation ?? []

    for (const [seriesKey, series] of Object.entries(ds)) {
      const obs = series.observations ?? {}
      for (const [obsKey, obsVal] of Object.entries(obs)) {
        const period = obsDims[0]?.values?.[parseInt(obsKey)]?.id ?? obsKey
        if (obsVal[0] !== null && obsVal[0] !== undefined) {
          results.push({ key: seriesKey, period, value: String(obsVal[0]) })
        }
      }
    }
  } catch {
    // malformed response — return empty
  }
  return results
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startRun('bis_statistics')
  const errors: string[] = []
  let found = 0, newItems = 0, dups = 0

  const BIS = 'https://stats.bis.org/api/v1'
  const ECB = 'https://sdw-wsrest.ecb.europa.eu/service'

  const periods = lastPeriods(4, 'Q')

  const queries = [
    // BIS: CPMI — retail payment transaction volumes by country
    // WS_CPMI_DIGITISATION: digital payments
    {
      label: 'BIS CPMI retail payments volume',
      url: sdmxUrl(BIS, 'WS_CPMI_DIGITISATION', 'Q.5J+GB+FR+DE+AU.C.A1+A2+A3+A4.A', periods),
      source: 'bis_statistics',
      event_type: 'payment_volume_update',
    },
    // BIS: Effective exchange rates (monthly)
    {
      label: 'BIS effective exchange rates',
      url: sdmxUrl(BIS, 'WS_EER_M', `M.N.B.GB+FR+DE+AU`, lastPeriods(3, 'M')),
      source: 'bis_statistics',
      event_type: 'fx_rate_update',
    },
    // ECB: SEPA credit transfer volumes (monthly)
    // BSI.M.U2.N.A.A20T.A.1.U2.2250.Z01.E — pan-EU SEPA stats
    {
      label: 'ECB SEPA instant credit transfers',
      url: sdmxUrl(ECB, 'BSI/M.U2.N.A.A20T.A.1.U2.2250.Z01.E', '', lastPeriods(3, 'M')),
      source: 'sepa_epc',
      event_type: 'sepa_volume_update',
    },
    // ECB: FX reference rates vs major currencies
    {
      label: 'ECB FX reference rates',
      url: sdmxUrl(ECB, 'EXR/D.GBP+USD+JPY+AUD+INR+BRL+ZAR.EUR.SP00.A', '', lastPeriods(5, 'M')),
      source: 'bis_statistics',
      event_type: 'fx_rate_update',
    },
  ]

  for (const q of queries) {
    try {
      const data = await fetchSdmx(q.url)
      const series = extractSeries(data as Record<string, unknown>)
      found += series.length

      if (series.length > 0) {
        // Write one consolidated event per query with all the period data
        const latest = series.reduce((acc, s) => {
          if (!acc[s.key] || s.period > acc[s.key].period) acc[s.key] = s
          return acc
        }, {} as Record<string, { key: string; period: string; value: string }>)

        const url = `${q.url}`
        const written = await writeSourceEvent({
          source: q.source,
          event_type: q.event_type,
          event_date: new Date().toISOString().split('T')[0],
          url,
          raw_content: {
            label: q.label,
            series_count: series.length,
            latest_values: Object.values(latest),
            all_series: series.slice(0, 100), // cap to avoid huge payloads
          },
          source_metadata: {
            data_source: q.source === 'sepa_epc' ? 'ECB SDW' : 'BIS SDMX API',
            query_url: q.url,
            periods_covered: `${periods.startPeriod} to ${periods.endPeriod}`,
          },
        })

        if (written) newItems++
        else dups++
      }

      await new Promise(r => setTimeout(r, 500))

    } catch (err) {
      errors.push(`${q.label}: ${err instanceof Error ? err.message : 'error'}`)
    }
  }

  await completeRun(runId, { found, new: newItems, duplicate: dups }, errors)

  return NextResponse.json({
    queries_run: queries.length,
    data_points_found: found,
    events_new: newItems,
    events_duplicate: dups,
    errors: errors.length ? errors : undefined,
  })
}
