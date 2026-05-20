import { createClient } from '@supabase/supabase-js'

export function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ── Run logging ───────────────────────────────────────────────────────

export async function startRun(source: string): Promise<string> {
  const sb = getSupabase()
  const { data } = await sb
    .from('loro_ingest_runs')
    .insert({ source, status: 'running' })
    .select('id')
    .single()
  return data?.id ?? 'unknown'
}

export async function completeRun(
  runId: string,
  counts: { found: number; new: number; duplicate: number },
  errors: string[] = []
) {
  const sb = getSupabase()
  await sb
    .from('loro_ingest_runs')
    .update({
      completed_at: new Date().toISOString(),
      events_found: counts.found,
      events_new: counts.new,
      events_duplicate: counts.duplicate,
      errors: errors.length ? errors : [],
      status: errors.length && counts.new === 0 ? 'failed' : errors.length ? 'partial' : 'completed',
    })
    .eq('id', runId)
}

// ── Deduplication ─────────────────────────────────────────────────────
// Check if a source event with this URL/reference already exists

export async function isDuplicate(
  source: string,
  urlOrRef: string
): Promise<boolean> {
  const sb = getSupabase()
  const { count } = await sb
    .from('loro_source_events')
    .select('id', { count: 'exact', head: true })
    .eq('source', source)
    .eq('url', urlOrRef)
  return (count ?? 0) > 0
}

// ── Write a source event ──────────────────────────────────────────────

export interface SourceEventInput {
  source: string
  event_type: string
  entity_id?: string
  event_date: string          // ISO date string
  raw_content: Record<string, unknown>
  source_metadata?: Record<string, unknown>
  url?: string
}

export async function writeSourceEvent(evt: SourceEventInput): Promise<boolean> {
  // Deduplicate by URL if present
  if (evt.url && await isDuplicate(evt.source, evt.url)) return false

  const sb = getSupabase()
  const { error } = await sb.from('loro_source_events').insert({
    source: evt.source,
    event_type: evt.event_type,
    entity_id: evt.entity_id ?? null,
    event_date: evt.event_date,
    raw_content: evt.raw_content,
    source_metadata: evt.source_metadata ?? {},
    url: evt.url ?? null,
    processed: false,
  })

  if (error) throw new Error(`writeSourceEvent: ${error.message}`)
  return true
}

// ── Write a news coverage item ────────────────────────────────────────

export interface NewsCoverageInput {
  publication: string
  headline: string
  summary?: string
  url: string
  published_at: string
  entities_mentioned?: string[]
  categories_detected?: string[]
}

export async function writeNewsCoverage(item: NewsCoverageInput): Promise<boolean> {
  const sb = getSupabase()

  // Deduplicate by URL
  const { count } = await sb
    .from('loro_news_coverage')
    .select('id', { count: 'exact', head: true })
    .eq('url', item.url)
  if ((count ?? 0) > 0) return false

  const { error } = await sb.from('loro_news_coverage').insert({
    publication: item.publication,
    headline: item.headline,
    summary: item.summary ?? null,
    url: item.url,
    published_at: item.published_at,
    entities_mentioned: item.entities_mentioned ?? [],
    categories_detected: item.categories_detected ?? [],
    processed: false,
  })

  if (error) throw new Error(`writeNewsCoverage: ${error.message}`)
  return true
}

// ── Simple XML → object (for RSS parsing, no external dep) ───────────

export function extractRssItems(xml: string): Array<{
  title: string
  link: string
  description: string
  pubDate: string
}> {
  const items: Array<{ title: string; link: string; description: string; pubDate: string }> = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))
      return (m?.[1] ?? m?.[2] ?? '').trim()
    }
    items.push({
      title: get('title'),
      link: get('link'),
      description: get('description'),
      pubDate: get('pubDate'),
    })
  }
  return items
}

// ── Payments keyword filter ───────────────────────────────────────────
// Only ingest RSS items relevant to Loro's coverage areas

const PAYMENTS_KEYWORDS = [
  'payment', 'fintech', 'banking', 'financial', 'pdmr', 'insider',
  'visa', 'mastercard', 'stripe', 'adyen', 'paypal', 'revolut', 'wise',
  'monzo', 'starling', 'klarna', 'checkout', 'gocardless', 'modulr',
  'currencycloud', 'open banking', 'psd2', 'psd3', 'sepa', 'swift',
  'fx ', 'foreign exchange', 'corridor', 'settlement', 'regulation',
  'fca', 'esma', 'bafin', 'amf', 'eba', 'psrg', 'psr',
  'series a', 'series b', 'series c', 'funding round', 'raises',
  'acquisition', 'merger', 'ipo', 'listing', 'valuation',
  'crypto', 'blockchain', 'stablecoin', 'cbdc', 'defi',
]

export function isRelevant(text: string): boolean {
  const lower = text.toLowerCase()
  return PAYMENTS_KEYWORDS.some(kw => lower.includes(kw))
}

// ── Detect categories from text ───────────────────────────────────────

export function detectCategories(text: string): string[] {
  const lower = text.toLowerCase()
  const cats: string[] = []
  if (/payment|sepa|swift|settlement|a2a|open banking/.test(lower)) cats.push('Payments')
  if (/fx |foreign exchange|corridor|treasury|forex/.test(lower)) cats.push('FX & Treasury')
  if (/bank|deposit|credit|loan|mortgage/.test(lower)) cats.push('Banking')
  if (/regulat|fca|esma|bafin|amf|compliance|licence|authoris/.test(lower)) cats.push('Regulation')
  if (/funding|raises|series|venture|invest|valuat/.test(lower)) cats.push('Fintech Funding')
  if (/pdmr|insider|ownership|shareholding|director/.test(lower)) cats.push('Ownership Intel')
  if (/open banking|psd2|psd3|api|tpp/.test(lower)) cats.push('Open Banking')
  if (/crypto|blockchain|bitcoin|ethereum|stablecoin|defi|cbdc/.test(lower)) cats.push('On-chain')
  return [...new Set(cats)]
}
