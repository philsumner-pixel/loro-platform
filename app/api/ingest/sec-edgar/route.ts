import { NextResponse } from 'next/server'
import {
  getSupabase,
  startRun,
  completeRun,
  writeSourceEvent,
} from '@/lib/ingest/utils'

// SEC EDGAR EDGAR full-text search API — no key required
// Docs: https://efts.sec.gov/LATEST/search-index?q=%22form+4%22&dateRange=custom&startdt=2024-01-01
// Company submissions: https://data.sec.gov/submissions/CIK{cik}.json
// Recent filings RSS: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=4&dateb=&owner=include&count=10&output=atom

export const runtime = 'nodejs'
export const maxDuration = 60

// Core payments companies we monitor by default (CIK numbers)
// Supplemented by loro_source_watchlist entries with source='sec_form4'
const DEFAULT_WATCHLIST: Array<{ name: string; cik: string; ticker: string }> = [
  { name: 'PayPal Holdings', cik: '0001633917', ticker: 'PYPL' },
  { name: 'Visa Inc', cik: '0001403161', ticker: 'V' },
  { name: 'Mastercard', cik: '0001141391', ticker: 'MA' },
  { name: 'Block Inc', cik: '0001512673', ticker: 'SQ' },
  { name: 'Stripe (N/A)', cik: '', ticker: '' }, // private, skip
  { name: 'Adyen NV', cik: '0001822250', ticker: 'ADYEN' },
  { name: 'Fiserv', cik: '0000798354', ticker: 'FI' },
  { name: 'Fidelity National Information Services', cik: '0000798011', ticker: 'FIS' },
  { name: 'Jack Henry & Associates', cik: '0000896429', ticker: 'JKHY' },
  { name: 'WEX Inc', cik: '0001309108', ticker: 'WEX' },
  { name: 'Green Dot', cik: '0001386110', ticker: 'GDOT' },
]

async function fetchEdgarFilings(
  cik: string,
  formType: '4' | '8-K',
  daysBack = 7
): Promise<Array<{
  accessionNumber: string
  filedAt: string
  form: string
  primaryDocument: string
}>> {
  // Pad CIK to 10 digits
  const paddedCik = cik.replace(/^0+/, '').padStart(10, '0')
  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Loro Intelligence editorial@loro.co',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new Error(`EDGAR ${cik}: HTTP ${res.status}`)

  const data = await res.json()
  const recent = data.filings?.recent
  if (!recent) return []

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)

  const results: Array<{ accessionNumber: string; filedAt: string; form: string; primaryDocument: string }> = []

  for (let i = 0; i < (recent.form ?? []).length; i++) {
    const form = recent.form[i]
    const filed = recent.filingDate[i]
    if (form !== formType) continue
    if (new Date(filed) < cutoff) continue

    results.push({
      accessionNumber: recent.accessionNumber[i],
      filedAt: filed,
      form,
      primaryDocument: recent.primaryDocument[i] ?? '',
    })
  }

  return results
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId4 = await startRun('sec_form4')
  const runId8k = await startRun('sec_8k')
  const errors: string[] = []
  let found = 0, newItems = 0, dups = 0

  try {
    const sb = getSupabase()

    // Merge default watchlist with DB watchlist
    const { data: dbWatchlist } = await sb
      .from('loro_source_watchlist')
      .select('config, entity_id')
      .in('source', ['sec_form4', 'sec_8k'])
      .eq('active', true)

    const watchlist = [
      ...DEFAULT_WATCHLIST.filter(w => w.cik),
      ...(dbWatchlist ?? []).map(w => ({
        name: '',
        cik: w.config?.cik ?? '',
        ticker: w.config?.ticker ?? '',
        entity_id: w.entity_id,
      })).filter(w => w.cik),
    ]

    for (const company of watchlist) {
      try {
        // Form 4 — insider trades
        const form4s = await fetchEdgarFilings(company.cik, '4', 7)
        found += form4s.length

        for (const filing of form4s) {
          const url = `https://www.sec.gov/Archives/edgar/data/${company.cik.replace(/^0+/, '')}/${filing.accessionNumber.replace(/-/g, '')}/${filing.primaryDocument}`

          const written = await writeSourceEvent({
            source: 'sec_form4',
            event_type: 'insider_trade',
            entity_id: (company as { entity_id?: string }).entity_id,
            event_date: filing.filedAt,
            url,
            raw_content: {
              company_name: company.name,
              cik: company.cik,
              ticker: company.ticker,
              accession_number: filing.accessionNumber,
              form: filing.form,
              primary_document: filing.primaryDocument,
            },
            source_metadata: {
              cik: company.cik,
              ticker: company.ticker,
              filing_date: filing.filedAt,
              form_type: '4',
            },
          })

          if (written) newItems++
          else dups++
        }

        // 8-K — material events
        const eightKs = await fetchEdgarFilings(company.cik, '8-K', 7)
        found += eightKs.length

        for (const filing of eightKs) {
          const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${company.cik}&type=8-K&dateb=&owner=include&count=10`

          const written = await writeSourceEvent({
            source: 'sec_8k',
            event_type: 'material_event',
            entity_id: (company as { entity_id?: string }).entity_id,
            event_date: filing.filedAt,
            url,
            raw_content: {
              company_name: company.name,
              cik: company.cik,
              ticker: company.ticker,
              accession_number: filing.accessionNumber,
              form: filing.form,
            },
            source_metadata: {
              cik: company.cik,
              ticker: company.ticker,
              filing_date: filing.filedAt,
              form_type: '8-K',
            },
          })

          if (written) newItems++
          else dups++
        }

        // Rate limit — SEC requests max 10/sec
        await new Promise(r => setTimeout(r, 200))

      } catch (err) {
        errors.push(`${company.name || company.cik}: ${err instanceof Error ? err.message : 'error'}`)
      }
    }

    await completeRun(runId4, { found, new: newItems, duplicate: dups }, errors)
    await completeRun(runId8k, { found, new: newItems, duplicate: dups }, errors)

    return NextResponse.json({ found, new: newItems, duplicates: dups, errors: errors.length ? errors : undefined })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown'
    await completeRun(runId4, { found, new: newItems, duplicate: dups }, [msg])
    await completeRun(runId8k, { found, new: newItems, duplicate: dups }, [msg])
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
