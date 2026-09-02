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
  errors: string[] = [],
  // Things worth recording that are not failures: records the source legitimately
  // cannot supply, work deferred to the next run. Kept out of the status
  // calculation, because a run whose only "errors" are expected gaps is a run
  // that worked. donor_resolution reported failure on all 42 of its runs
  // because six unresolvable company numbers were being counted as errors.
  notes: string[] = []
) {
  const sb = getSupabase()
  await sb
    .from('loro_ingest_runs')
    .update({
      completed_at: new Date().toISOString(),
      events_found: counts.found,
      events_new: counts.new,
      events_duplicate: counts.duplicate,
      errors: [...errors, ...notes.map(n => `note: ${n}`)],
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
  keyword_relevant?: boolean
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
    keyword_relevant: item.keyword_relevant ?? null,
    processed: false,
  })

  if (error) throw new Error(`writeNewsCoverage: ${error.message}`)
  return true
}

/**
 * Batched version of writeNewsCoverage.
 *
 * The per-item writer issues a SELECT COUNT then an INSERT for every single
 * item. Since collection was un-gated (every item a feed carries is now
 * ingested and relevance recorded as a column rather than used as a filter),
 * a run sees ~228 items of which ~226 are already known — so it was spending
 * the whole 60s budget on ~228 sequential round trips to confirm that almost
 * nothing was new.
 *
 * `loro_news_coverage_url_key` is a plain unique index on url, so the database
 * can do that deduplication itself in a single statement. With
 * ignoreDuplicates the upsert becomes ON CONFLICT DO NOTHING, and .select()
 * returns only the rows actually inserted — which gives us the new/duplicate
 * split for free.
 */
export async function writeNewsCoverageBatch(
  items: NewsCoverageInput[]
): Promise<{ inserted: number; duplicate: number }> {
  if (!items.length) return { inserted: 0, duplicate: 0 }

  // Collapse duplicates within the batch first. A feed can carry the same URL
  // twice, and ON CONFLICT cannot resolve two conflicting rows in one
  // statement — Postgres raises "cannot affect row a second time".
  const byUrl = new Map<string, NewsCoverageInput>()
  for (const item of items) {
    if (item.url) byUrl.set(item.url, item)
  }
  const unique = [...byUrl.values()]

  const rows = unique.map(item => ({
    publication: item.publication,
    headline: item.headline,
    summary: item.summary ?? null,
    url: item.url,
    published_at: item.published_at,
    entities_mentioned: item.entities_mentioned ?? [],
    categories_detected: item.categories_detected ?? [],
    keyword_relevant: item.keyword_relevant ?? null,
    processed: false,
  }))

  const sb = getSupabase()
  let inserted = 0

  // Chunked so a very large feed cannot produce an oversized statement.
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await sb
      .from('loro_news_coverage')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'url', ignoreDuplicates: true })
      .select('id')

    if (error) throw new Error(`writeNewsCoverageBatch: ${error.message}`)
    inserted += data?.length ?? 0
  }

  return { inserted, duplicate: unique.length - inserted }
}

/**
 * Strip HTML tags from untrusted feed content.
 *
 * A single-pass `.replace(/<[^>]+>/g, '')` is not safe: removing a sequence can
 * reassemble the very thing it removed. `<scr<foo>ipt>` loses `<foo>` and
 * becomes `<script>`. Repeat until the string stops changing, then neutralise
 * any stray bracket left over from an unclosed tag.
 *
 * Termination is guaranteed — every pass either shortens the string or leaves
 * it identical, which ends the loop.
 */
export function stripTags(input: string, replacement = ''): string {
  let out = input
  let prev: string
  do {
    prev = out
    out = out.replace(/<[^>]*>/g, replacement)
  } while (out !== prev)
  return out.replace(/[<>]/g, replacement)
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
