import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import TickerStrip from '@/components/TickerStrip'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'
import LaneNav from '@/components/LaneNav'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Search — Loro',
  description: 'Search Loro stories, the companies and people in its entity graph, and the primary records behind them.',
}

interface R { kind: string; title: string; subtitle: string; url: string; meta: string }

async function search(q: string): Promise<R[]> {
  if (!q || q.trim().length < 2) return []
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data } = await sb.rpc('loro_search', { q: q.trim(), max_each: 10 })
    return (data ?? []) as R[]
  } catch { return [] }
}

const LABEL: Record<string, string> = {
  article: 'Story', entity: 'Company or person', record: 'Primary record',
}

export default async function SearchPage({
  searchParams,
}: { searchParams: { q?: string } }) {
  const q = searchParams.q ?? ''
  const results = await search(q)
  const grouped = ['article', 'entity', 'record']
    .map(k => ({ kind: k, items: results.filter(r => r.kind === k) }))
    .filter(g => g.items.length)

  return (
    <>
      <TickerStrip />
      <Masthead />
      <LaneNav />

      <main className="loro-search">
        <header>
          <h1>Search</h1>
          <p>
            Stories, the companies and people Loro tracks, and the primary records
            behind them — filings, donations, contracts and disclosures.
          </p>
          {/* A plain GET form: no JavaScript needed, and the results page is a
              real URL a reader can share or a crawler can follow. */}
          <form action="/search" method="get">
            <input name="q" defaultValue={q} autoFocus
              placeholder="A company, a person, a topic — Revolut, Bamford, planning…" />
            <button type="submit">Search</button>
          </form>
        </header>

        {q && results.length === 0 && (
          <p className="loro-search-empty">
            Nothing found for &ldquo;{q}&rdquo;. Loro indexes what it has read — if a company
            has not appeared in a register we monitor, it will not be here.
          </p>
        )}

        {grouped.map(g => (
          <section key={g.kind} className="loro-search-group">
            <h2>{LABEL[g.kind]}<span>{g.items.length}</span></h2>
            {g.items.map((r, i) => (
              <a key={`${r.kind}-${i}`} href={r.url}
                 className="loro-search-item"
                 {...(r.kind === 'record' ? { target: '_blank', rel: 'noopener' } : {})}>
                <h3>{r.title}</h3>
                {r.subtitle && <p>{r.subtitle}</p>}
                {r.meta && <span className="meta">{r.meta}</span>}
              </a>
            ))}
          </section>
        ))}
      </main>

      <SiteFooter />
    </>
  )
}
