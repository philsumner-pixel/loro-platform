import { NextRequest, NextResponse } from 'next/server'
import { getSupabase, startRun, completeRun, writeSourceEvent } from '@/lib/ingest/utils'

// FCA PDMR Ingestor
// Source: Investegate director dealings category (aggregates LSE RNS + EQS + other PIPs)
// All PDMR notifications under UK MAR Article 19 appear here in near-real-time
// Schedule: every 15 minutes
//
// Two-stage process:
// 1. Fetch the category feed — get announcement headlines + links
// 2. For each payments-relevant match, fetch full announcement + parse MAR Article 19 structured data

export const runtime = 'nodejs'
export const maxDuration = 55

// Payments company names and patterns — match against announcement issuers
// Expanded with FCA-regulated payment institutions + listed payments companies
const PAYMENTS_COMPANIES = new Set([
  // Listed UK payments / fintech
  'wise', 'wise payments', 'network international', 'network intl',
  'funding circle', 'worldline', 'nexi', 'ingenico',
  'finablr', 'euronet', 'stelrad',
  // UK challengers / EMIs
  'revolut', 'monzo', 'starling', 'oaknorth', 'tandem',
  'atom bank', 'bn1', 'allica bank', 'griffin bank', 'griffin bank ltd',
  'modulr', 'modulr finance', 'clearbank', 'clear bank',
  'currencycloud', 'railsbank', 'railsr', 'soldo',
  'paypoint', 'pay.uk', 'vocalink', 'link scheme',
  'gocardless', 'ebury', 'airwallex',
  'checkout', 'checkout.com', 'payroc', 'paysafe', 'paymentsense',
  // Global payments — UK subsidiaries / listed
  'paypal', 'visa', 'mastercard', 'american express', 'amex',
  'worldpay', 'adyen', 'stripe', 'square', 'block inc', 'block,',
  'klarna', 'affirm', 'zip co',
  'western union', 'moneygram', 'transferwise',
  'marqeta', 'rapyd', 'nuvei', 'shift4',
  // UK banking with payments focus
  'barclaycard', 'lloyds merchant services',
  'santander uk', 'hsbc payments', 'natwest',
  'international personal finance', 'ipf',
  // Payments infrastructure
  'form3', 'bottomline', 'bottomline technologies',
  'finastra', 'fis ', 'fiserv', 'temenos',
  'wex', 'wex inc', 'fleetcor', 'corpay',
  'netsol technologies', 'intelligent systems',
])

// Keywords in headline/description that suggest payments relevance
const PAYMENTS_KEYWORDS = [
  'payment', 'fintech', 'financial technology', 'digital banking',
  'money transfer', 'remittance', 'foreign exchange', 'currency',
  'merchant services', 'acquiring', 'issuing', 'card network',
  'open banking', 'psd2', 'psd3', 'e-money', 'electronic money',
  'lending', 'credit', 'buy now pay later', 'bnpl',
]

function isPaymentsRelevant(companyName: string, description: string = ''): boolean {
  const cn = companyName.toLowerCase()
  const desc = description.toLowerCase()
  
  // Direct company name match
  for (const co of PAYMENTS_COMPANIES) {
    if (cn.includes(co)) return true
  }
  
  // Keyword match in description
  for (const kw of PAYMENTS_KEYWORDS) {
    if (desc.includes(kw)) return true
  }
  
  return false
}

// Parse the MAR Article 19 structured PDMR notification body
// The format is standardised under Commission Implementing Regulation 2016/523
function parsePdmrBody(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  
  // Person name — field 1a
  const nameMatch = text.match(/1\s*[a-z]\)\s*Name\s*:?\s*([^\n\r]+)/i)
    ?? text.match(/Name\s*of\s*PDMR\s*:?\s*([^\n\r]+)/i)
  if (nameMatch) result.person_name = nameMatch[1].trim()

  // Position — field 2a
  const posMatch = text.match(/position\s*\/?\s*status\s*:?\s*([^\n\r]+)/i)
    ?? text.match(/role\s*:?\s*([^\n\r]+)/i)
  if (posMatch) result.person_role = posMatch[1].trim()

  // Issuer name — field 3a
  const issuerMatch = text.match(/(?:details\s+of\s+the\s+issuer[\s\S]{0,50}?)Name\s*:?\s*([^\n\r]+)/i)
  if (issuerMatch) result.issuer_name = issuerMatch[1].trim()

  // LEI — field 3b
  const leiMatch = text.match(/LEI\s*:?\s*([A-Z0-9]{20})/i)
  if (leiMatch) result.lei = leiMatch[1].trim()

  // Transaction type — field 4b
  const txTypeMatch = text.match(/nature\s+of\s+(?:the\s+)?transaction\s*:?\s*([^\n\r]+)/i)
  if (txTypeMatch) result.transaction_type = txTypeMatch[1].trim()

  // Price per share — field 4c
  const priceMatch = text.match(/price\s*:?\s*(?:GBX?|USD|EUR|£|\$|€)?\s*([\d,]+(?:\.\d+)?)/i)
  if (priceMatch) result.price_per_share = parseFloat(priceMatch[1].replace(/,/g, ''))

  // Volume / number of shares — field 4c
  const volMatch = text.match(/volume\s*:?\s*([\d,]+)/i)
    ?? text.match(/number\s+of\s+shares\s*:?\s*([\d,]+)/i)
  if (volMatch) result.shares_qty = parseInt(volMatch[1].replace(/,/g, ''))

  // Total value — field 4d
  const totalMatch = text.match(/(?:aggregate|total)\s+(?:consideration|value|amount)\s*:?\s*(?:GBX?|USD|EUR|£|\$|€)?\s*([\d,]+(?:\.\d+)?)/i)
  if (totalMatch) result.total_value = parseFloat(totalMatch[1].replace(/,/g, ''))

  // Transaction date — field 4e
  const dateMatch = text.match(/date\s+of\s+(?:the\s+)?transaction\s*:?\s*([^\n\r]+)/i)
    ?? text.match(/(?:effected|executed)\s+on\s+([^\n\r,]+)/i)
  if (dateMatch) result.transaction_date = dateMatch[1].trim()

  // Signal type — disposal or acquisition
  const bodyLower = text.toLowerCase()
  if (bodyLower.includes('disposal') || bodyLower.includes('sold') || bodyLower.includes('sale of')) {
    result.signal_type = 'disposal'
  } else if (bodyLower.includes('acquisition') || bodyLower.includes('purchased') || bodyLower.includes('exercise of')) {
    result.signal_type = 'acquisition'
  }

  return result
}

// Parse the Investegate category page HTML to extract announcement links
function parseInvestegateHtml(html: string): Array<{
  company: string; headline: string; url: string; time: string; source: string
}> {
  const results: Array<{ company: string; headline: string; url: string; time: string; source: string }> = []
  
  // Match table rows with announcement links
  // Pattern: /announcement/rns/company--ticker/headline/ID
  const rowPattern = /\/announcement\/([^"]+)\/(\d+)/g
  const linkPattern = /<a[^>]+href="(\/announcement\/[^"]+)"[^>]*>([^<]+)<\/a>/g
  
  let match
  const seen = new Set<string>()
  
  while ((match = linkPattern.exec(html)) !== null) {
    const [, href, text] = match
    if (seen.has(href)) continue
    seen.add(href)
    
    const urlParts = href.split('/')
    const id = urlParts[urlParts.length - 1]
    const headlineSlug = urlParts[urlParts.length - 2] ?? ''
    
    // Only include PDMR-related headlines
    const ispdmr = headlineSlug.includes('pdmr') ||
      headlineSlug.includes('director-pdmr') ||
      headlineSlug.includes('director-dealing') ||
      text.toLowerCase().includes('pdmr') ||
      text.toLowerCase().includes('director/pdmr') ||
      text.toLowerCase().includes('director shareholding')
    
    if (!ispdmr) continue
    
    // Extract company from URL: /announcement/rns/company-name--ticker/headline/id
    const companySlug = urlParts[3] ?? ''
    const company = companySlug
      .replace(/--[a-z0-9]+$/, '')  // remove ticker
      .replace(/-+/g, ' ')
      .trim()
    
    results.push({
      company,
      headline: text.trim(),
      url: `https://www.investegate.co.uk${href}`,
      time: '',
      source: urlParts[2] ?? 'rns',
    })
    
    if (results.length >= 50) break
  }
  
  return results
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startRun('fca_pdmr')
  const sb = getSupabase()
  const errors: string[] = []
  let found = 0
  let newEvents = 0
  let duplicates = 0

  try {
    // ── Stage 1: Fetch Investegate director dealings category ──────────
    const categoryUrl = 'https://www.investegate.co.uk/category/directors-dealings'
    
    let announcements: Array<{ company: string; headline: string; url: string; time: string; source: string }> = []
    
    try {
      const res = await fetch(categoryUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Loro-Intelligence/1.0; payments journalism; +https://loro-platform.vercel.app)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15000),
      })
      
      if (res.ok) {
        const html = await res.text()
        announcements = parseInvestegateHtml(html)
      } else {
        errors.push(`Investegate category: HTTP ${res.status}`)
      }
    } catch (err) {
      errors.push(`Investegate fetch: ${err instanceof Error ? err.message : 'error'}`)
    }

    found = announcements.length

    // ── Stage 2: Filter for payments relevance ─────────────────────────
    const relevant = announcements.filter(a => isPaymentsRelevant(a.company, a.headline))

    // ── Stage 3: Fetch + parse each relevant announcement ─────────────
    for (const ann of relevant.slice(0, 20)) {  // cap at 20 per run
      try {
        // Fetch full announcement body for structured data extraction
        let parsedData: Record<string, unknown> = {}
        
        try {
          const annRes = await fetch(ann.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; Loro-Intelligence/1.0)',
              'Accept': 'text/html',
            },
            signal: AbortSignal.timeout(10000),
          })
          
          if (annRes.ok) {
            const html = await annRes.text()
            const bodyText = html
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
            
            parsedData = parsePdmrBody(bodyText)
          }
        } catch {
          // If full fetch fails, use listing data only
        }

        // Determine event type from signal
        const eventType = parsedData.signal_type === 'disposal'
          ? 'fca_pdmr_sell'
          : parsedData.signal_type === 'acquisition'
            ? 'fca_pdmr_buy'
            : 'insider_trade'

        // Find matching entity
        const companyName = (parsedData.issuer_name as string) ?? ann.company
        const { data: matchedEntity } = await sb
          .from('loro_entities')
          .select('id, name')
          .ilike('name', `%${companyName.split(' ')[0]}%`)
          .limit(1)
          .single()

        // writeSourceEvent uses url for deduplication — pass it there
        const written = await writeSourceEvent({
          source: 'fca_pdmr',
          event_type: eventType,
          entity_id: matchedEntity?.id ?? undefined,
          event_date: (parsedData.transaction_date as string | undefined)
            ?? new Date().toISOString().split('T')[0],
          url: ann.url,
          raw_content: {
            company_name: companyName,
            headline: ann.headline,
            source_url: ann.url,
            person_name: parsedData.person_name,
            person_role: parsedData.person_role,
            transaction_type: parsedData.transaction_type,
            signal_type: parsedData.signal_type,
            shares_qty: parsedData.shares_qty,
            price_per_share: parsedData.price_per_share,
            total_value: parsedData.total_value,
            transaction_date: parsedData.transaction_date,
            lei: parsedData.lei,
            rns_source: ann.source,
          },
        })

        if (written) newEvents++
        else duplicates++

      } catch (err) {
        errors.push(`${ann.company}: ${err instanceof Error ? err.message : 'error'}`)
      }

      // Brief pause between announcement fetches
      await new Promise(r => setTimeout(r, 300))
    }

    await completeRun(runId, { found, new: newEvents, duplicate: duplicates }, errors)

    return NextResponse.json({
      found,
      payments_relevant: relevant.length,
      new: newEvents,
      duplicates,
      errors: errors.length ? errors : undefined,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown'
    await completeRun(runId, { found, new: newEvents, duplicate: duplicates }, [msg])
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
