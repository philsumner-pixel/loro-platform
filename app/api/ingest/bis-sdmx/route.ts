import { NextRequest, NextResponse } from 'next/server'
import { getSupabase, startRun, completeRun, writeSourceEvent } from '@/lib/ingest/utils'

// BIS + ECB SDMX Market Data Ingestor
// SDMX REST API — no API key required
// Fix: Accept header not query param for format specification
// Schedule: daily at 06:00 UTC (data updates daily)

export const runtime = 'nodejs'
export const maxDuration = 55

// SDMX REST API base URLs
const BIS_BASE  = 'https://stats.bis.org/api/v1'
const ECB_BASE  = 'https://data-api.ecb.europa.eu/service'

// Accept header for SDMX JSON — this is what was causing the 406
const SDMX_ACCEPT = 'application/vnd.sdmx.data+json;version=1.0.0'

// Generic SDMX fetch with correct headers
async function fetchSdmx(url: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, {
    headers: {
      'Accept': SDMX_ACCEPT,
      'User-Agent': 'Loro-Intelligence/1.0 (payments intelligence; contact: hello@loro.io)',
    },
    signal: AbortSignal.timeout(20000),
  })

  if (!res.ok) {
    throw new Error(`SDMX fetch failed: ${res.status} ${url}`)
  }

  return res.json()
}

// Extract data points from SDMX JSON response
function extractDataPoints(
  data: Record<string, unknown>,
  dimensionLabels: string[]
): Array<{ key: string; value: number; period: string }> {
  const points: Array<{ key: string; value: number; period: string }> = []

  try {
    const series = (data as { dataSets?: Array<{ series?: Record<string, { observations?: Record<string, [number]> }> }> })
      .dataSets?.[0]?.series ?? {}
    
    const structure = (data as { structure?: { dimensions?: { series?: Array<{ values?: Array<{ id?: string; name?: string }> }>, observation?: Array<{ values?: Array<{ id?: string }> }> } } }).structure

    const obsDimValues = structure?.dimensions?.observation?.[0]?.values ?? []

    for (const [seriesKey, seriesData] of Object.entries(series)) {
      const keyParts = seriesKey.split(':').map(Number)
      const dimensionValues = structure?.dimensions?.series?.map(
        (dim, i) => dim.values?.[keyParts[i]]?.id ?? ''
      ) ?? []
      const label = dimensionValues.filter(Boolean).join('.')

      const observations = seriesData.observations ?? {}
      for (const [obsIdx, obsData] of Object.entries(observations)) {
        const period = obsDimValues[parseInt(obsIdx)]?.id ?? obsIdx
        const value = (obsData as [number])[0]
        if (typeof value === 'number' && !isNaN(value)) {
          points.push({ key: label, value, period })
        }
      }
    }
  } catch {
    // Partial data is fine — return what we got
  }

  return points
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startRun('bis_sdmx')
  const sb = getSupabase()
  const errors: string[] = []
  let totalPoints = 0
  let totalNew = 0

  const TODAY = new Date().toISOString().split('T')[0]
  const PERIOD_START_M  = TODAY.substring(0, 7).replace('-', '-')  // YYYY-MM
  const PERIOD_START_Q  = `${TODAY.substring(0, 4)}-Q1`             // YYYY-Q1

  const queries = [
    // ── BIS Effective Exchange Rates (monthly) ────────────────────────
    // Narrow EERs for GBP, EUR, USD, JPY — key payments corridor benchmark
    {
      name: 'BIS EER monthly (GBP/EUR/USD)',
      url: `${BIS_BASE}/data/WS_EER_M/M.N.B.GB+US+JP+FR+DE+AU?startPeriod=2026-01&endPeriod=${PERIOD_START_M}`,
      eventType: 'fx_rate_update',
      valueLabel: 'BIS narrow EER',
    },
    // ── ECB FX reference rates ─────────────────────────────────────────
    // EUR/GBP, EUR/USD — key Loro coverage corridors
    {
      name: 'ECB FX reference rates (EUR/GBP, EUR/USD)',
      url: `${ECB_BASE}/data/EXR/D.GBP+USD.EUR.SP00.A?startPeriod=2026-01-01&endPeriod=${TODAY}`,
      eventType: 'fx_rate_update',
      valueLabel: 'ECB FX reference',
    },
    // ── ECB SEPA instant credit transfer statistics ───────────────────
    // Volume and value of SEPA instant payments — payments market intelligence
    {
      name: 'ECB SEPA payment statistics',
      url: `${ECB_BASE}/data/PSS/A.4F0.N.I4.NT0.EUR.R.Z..2C.A?startPeriod=2024&endPeriod=2025`,
      eventType: 'payment_volume_update',
      valueLabel: 'ECB SEPA instant payments',
    },
  ]

  for (const query of queries) {
    try {
      const data = await fetchSdmx(query.url)
      if (!data) { errors.push(`${query.name}: no data`); continue }

      const points = extractDataPoints(data, [])
      totalPoints += points.length

      // Write the most recent data point as a source event
      const latest = points.sort((a, b) => b.period.localeCompare(a.period))[0]
      if (!latest) continue

      const written = await writeSourceEvent({
        source: 'bis_statistics',
        event_type: query.eventType,
        event_date: TODAY,
        raw_content: {
          dataset: query.name,
          label: query.valueLabel,
          latest_period: latest.period,
          latest_value: latest.value,
          series_key: latest.key,
          data_points_available: points.length,
        },
      })

      if (written) totalNew++

    } catch (err) {
      errors.push(`${query.name}: ${err instanceof Error ? err.message : 'error'}`)
    }
  }

  await completeRun(runId, { found: totalPoints, new: totalNew, duplicate: 0 }, errors)

  return NextResponse.json({
    queries_run: queries.length,
    data_points_found: totalPoints,
    events_new: totalNew,
    errors: errors.length ? errors : undefined,
  })
}
