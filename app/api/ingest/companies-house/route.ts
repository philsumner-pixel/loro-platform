import { NextResponse } from 'next/server'
import {
  getSupabase,
  startRun,
  completeRun,
  writeSourceEvent,
} from '@/lib/ingest/utils'

// Companies House API — requires free API key
// Register: https://developer.company-information.service.gov.uk/
// Docs: https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference

export const runtime = 'nodejs'
export const maxDuration = 60

// Default UK payments/fintech watchlist — Company House numbers
// Extended by loro_source_watchlist with source='companies_house'
const DEFAULT_WATCHLIST = [
  { name: 'Revolut Ltd', number: '08804411' },
  { name: 'Wise Payments Ltd', number: '07813581' },
  { name: 'Monzo Bank Ltd', number: '09446231' },
  { name: 'Starling Bank Ltd', number: '09119430' },
  { name: 'Modulr Finance Ltd', number: '09897957' },
  { name: 'GoCardless Ltd', number: '07495895' },
  { name: 'SumUp Holdings Ltd', number: '08227513' },
  { name: 'Checkout.com Ltd', number: '10841971' },
  { name: 'Currencycloud Group Ltd', number: '09674780' },
  { name: 'Klarna Bank AB (UK)', number: '14189101' },
  { name: 'Adyen N.V. (UK branch)', number: 'FC034953' },
  { name: 'PayPal (Europe) UK', number: '04947947' },
  { name: 'Stripe Technology Europe Ltd', number: '13716785' },
  { name: 'Railsr (formerly Railsbank)', number: '10172988' },
  { name: 'Clearbank Ltd', number: '09736208' },
  { name: 'Griffin Bank Ltd', number: '11977667' },
  { name: 'Kroo Bank Ltd', number: '12252552' },
  { name: 'Allica Bank Ltd', number: '10768290' },
  { name: 'OakNorth Bank Ltd', number: '09056652' },
  { name: 'Paysafe Holdings UK', number: '03080268' },
]

// Filing types that are most likely to signal a story
const HIGH_SIGNAL_TYPES = [
  'AP01', // Appointment of director
  'TM01', // Termination of director
  'AP02', // Appointment of corporate director
  'TM02', // Termination of corporate director
  'AD01', // Change of registered office
  'AA',   // Annual accounts
  'CS01', // Confirmation statement — shows ownership changes
  'MR01', // Charge created (borrowing activity)
  'SH01', // Return of allotment of shares
  'RP01', // Remove a person with significant control
  'PSC04',// Change of details of PSC
]

async function fetchFilings(
  companyNumber: string,
  daysBack = 7
): Promise<Array<{
  transactionId: string
  date: string
  type: string
  description: string
  links: { documentMetadata?: string }
}>> {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY
  if (!apiKey) throw new Error('COMPANIES_HOUSE_API_KEY not set')

  const url = `https://api.company-information.service.gov.uk/company/${companyNumber}/filing-history?items_per_page=20`

  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  })

  if (res.status === 404) return [] // company not found — skip silently
  if (!res.ok) throw new Error(`CH ${companyNumber}: HTTP ${res.status}`)

  const data = await res.json()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)

  return (data.items ?? []).filter((item: { date: string }) => new Date(item.date) >= cutoff)
}

export async function GET(req: Request) {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      error: 'COMPANIES_HOUSE_API_KEY not set. Register at developer.company-information.service.gov.uk'
    }, { status: 503 })
  }

  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startRun('companies_house')
  const errors: string[] = []
  let found = 0, newItems = 0, dups = 0

  try {
    const sb = getSupabase()

    // Merge default + DB watchlist
    const { data: dbWatchlist } = await sb
      .from('loro_source_watchlist')
      .select('config, entity_id')
      .eq('source', 'companies_house')
      .eq('active', true)

    const watchlist = [
      ...DEFAULT_WATCHLIST.map(w => ({ ...w, entity_id: undefined })),
      ...(dbWatchlist ?? []).map(w => ({
        name: w.config?.name ?? '',
        number: w.config?.company_number ?? '',
        entity_id: w.entity_id as string,
      })).filter(w => w.number),
    ]

    for (const company of watchlist) {
      try {
        const filings = await fetchFilings(company.number, 14) // 14 days look-back
        found += filings.length

        for (const filing of filings) {
          // Score the signal — high-signal types get flagged
          const isHighSignal = HIGH_SIGNAL_TYPES.includes(filing.type)

          const url = `https://find-and-update.company-information.service.gov.uk/company/${company.number}/filing-history`

          const written = await writeSourceEvent({
            source: 'companies_house',
            event_type: isHighSignal ? `director_change_or_ownership` : 'filing',
            entity_id: company.entity_id,
            event_date: filing.date,
            url,
            raw_content: {
              company_name: company.name,
              company_number: company.number,
              filing_type: filing.type,
              description: filing.description,
              transaction_id: filing.transactionId,
              high_signal: isHighSignal,
            },
            source_metadata: {
              company_number: company.number,
              filing_type: filing.type,
              high_signal: isHighSignal,
            },
          })

          if (written) newItems++
          else dups++
        }

        // Rate limit — 600 req / 5min = max 2/sec
        await new Promise(r => setTimeout(r, 600))

      } catch (err) {
        errors.push(`${company.name}: ${err instanceof Error ? err.message : 'error'}`)
      }
    }

    await completeRun(runId, { found, new: newItems, duplicate: dups }, errors)

    return NextResponse.json({
      companies_checked: watchlist.length,
      filings_found: found,
      events_new: newItems,
      events_duplicate: dups,
      errors: errors.length ? errors : undefined,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown'
    await completeRun(runId, { found, new: newItems, duplicate: dups }, [msg])
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
