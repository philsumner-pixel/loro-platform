import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun } from '@/lib/ingest/utils'

// ── CISA KNOWN EXPLOITED VULNERABILITIES ────────────────────────────────
// Fills Technology & Infrastructure, which had zero candidates.
//
// This is the US government's authoritative list of vulnerabilities being
// ACTIVELY exploited in the wild — not theoretical CVEs. Each entry names the
// vendor and product, so it joins to the entity graph: a KEV entry naming a
// payments or banking vendor is a story about operational risk at every firm
// that runs it.
//
// Free, no key, public domain. Single JSON document, republished as new
// vulnerabilities are added.
//
// ?probe=1 returns the upstream shape without writing.

export const runtime = 'nodejs'
export const maxDuration = 60

const FEED = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
const UA = 'Loro Intelligence (contact: hello@loro.media)'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface Kev {
  cveID?: string
  vendorProject?: string
  product?: string
  vulnerabilityName?: string
  dateAdded?: string
  shortDescription?: string
  requiredAction?: string
  dueDate?: string
  knownRansomwareCampaignUse?: string
  notes?: string
  cwes?: string[]
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const probe = url.searchParams.get('probe') === '1'

  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!probe && cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = probe ? '' : await startRun('cisa_kev')
  const sb = getSupabase()
  const errors: string[] = []
  let found = 0, inserted = 0, dupes = 0

  try {
    const res = await fetch(FEED, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) throw new Error(`CISA feed ${res.status}`)

    const json = await res.json() as {
      catalogVersion?: string
      dateReleased?: string
      count?: number
      vulnerabilities?: Kev[]
    }

    const all = json.vulnerabilities ?? []
    found = all.length

    if (probe) {
      return NextResponse.json({
        probe: true,
        catalog_version: json.catalogVersion,
        date_released: json.dateReleased,
        total_in_catalog: found,
        first_item_keys: all[0] ? Object.keys(all[0]) : null,
        newest_three: all
          .slice()
          .sort((a, b) => (b.dateAdded ?? '').localeCompare(a.dateAdded ?? ''))
          .slice(0, 3),
      })
    }

    // Only recent additions — the catalogue is cumulative and runs to well over
    // a thousand entries, but only new ones are news.
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)
    const recent = all
      .filter(v => (v.dateAdded ?? '') >= cutoff)
      .sort((a, b) => (b.dateAdded ?? '').localeCompare(a.dateAdded ?? ''))
      .slice(0, 120)

    const rows = recent
      .filter(v => v.cveID)
      .map(v => {
        const vendor = v.vendorProject ?? 'Unknown vendor'
        const product = v.product ?? ''
        const ransomware = v.knownRansomwareCampaignUse === 'Known'
        return {
          source: 'cisa_kev',
          event_type: ransomware ? 'exploited_vulnerability_ransomware' : 'exploited_vulnerability',
          event_date: v.dateAdded ?? new Date().toISOString().slice(0, 10),
          url: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
          raw_content: {
            title: `${vendor} ${product}: ${v.vulnerabilityName ?? v.cveID} actively exploited`,
            description: [
              v.shortDescription,
              v.requiredAction ? `Required action: ${v.requiredAction}` : null,
              v.dueDate ? `Federal remediation due ${v.dueDate}.` : null,
              ransomware ? 'Known to be used in ransomware campaigns.' : null,
            ].filter(Boolean).join(' '),
            cve: v.cveID,
            vendor,
            product,
            ransomware_use: ransomware,
          },
          source_metadata: {
            cve: v.cveID,
            vendor,
            product,
            due_date: v.dueDate ?? null,
            ransomware_use: ransomware,
            cwes: v.cwes ?? null,
            catalog_version: json.catalogVersion ?? null,
          },
          processed: false,
        }
      })

    if (rows.length) {
      const urls = rows.map(r => r.url)
      const { data: seen } = await sb
        .from('loro_source_events')
        .select('url')
        .eq('source', 'cisa_kev')
        .in('url', urls)

      const seenSet = new Set((seen ?? []).map(s => s.url as string))
      const fresh = rows.filter(r => !seenSet.has(r.url))
      dupes = rows.length - fresh.length

      if (fresh.length) {
        const { data: ins, error } = await sb
          .from('loro_source_events')
          .insert(fresh)
          .select('id')
        if (error) errors.push(`insert: ${error.message}`)
        inserted = ins?.length ?? 0
      }
    }

    await completeRun(runId, { found: rows.length, new: inserted, duplicate: dupes }, errors)
    return NextResponse.json({
      ok: true,
      catalog_total: found,
      recent_considered: rows.length,
      inserted, duplicates: dupes,
      errors: errors.slice(0, 3),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    if (!probe) await completeRun(runId, { found, new: inserted, duplicate: dupes }, [msg])
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
