import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun } from '@/lib/ingest/utils'

// ── UK PUBLIC PROCUREMENT (Contracts Finder, OCDS) ──────────────────────
// The missing side of the influence circuit. Loro can already see who funds
// politics (Electoral Commission), who controls those companies (Companies
// House) and what MPs declared (Register of Interests). This adds who WINS
// PUBLIC CONTRACTS — so the question becomes whether a donor also receives
// public money.
//
// Award notices specifically: a tender is an opportunity, an award names the
// supplier and the value. Suppliers carry a Companies House number, which is
// the same join key the donation data uses.
//
// Free, no API key, Open Government Licence. Cabinet Office publishes
// continuously; awards above £12k central government / £25k wider public
// sector and NHS.
//
// ?probe=1 returns the upstream shape without writing.

export const runtime = 'nodejs'
export const maxDuration = 60

const BASE = 'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search'
const UA = 'Loro Intelligence (contact: hello@loro.media)'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface OcdsParty {
  id?: string
  name?: string
  roles?: string[]
  identifier?: { id?: string; scheme?: string; legalName?: string }
}
interface OcdsAward {
  id?: string
  title?: string
  date?: string
  value?: { amount?: number; currency?: string }
  suppliers?: Array<{ id?: string; name?: string }>
}
interface OcdsRelease {
  ocid?: string
  id?: string
  date?: string
  tag?: string[]
  buyer?: { name?: string; id?: string }
  parties?: OcdsParty[]
  tender?: {
    title?: string
    description?: string
    value?: { amount?: number; currency?: string }
    classification?: { id?: string; description?: string }
  }
  awards?: OcdsAward[]
}

/** Companies House number for a supplier, where the buyer published one. */
function supplierCompanyNumber(parties: OcdsParty[], supplierId?: string): string | null {
  const p = parties.find(x => x.id === supplierId)
  const ident = p?.identifier
  if (!ident?.id) return null
  // GB-COH is the Companies House scheme in OCDS.
  if (ident.scheme && !/COH|COMPANIES/i.test(ident.scheme)) return null
  const raw = String(ident.id).toUpperCase().trim()
  return /^\d+$/.test(raw) ? raw.padStart(8, '0') : raw
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const probe = url.searchParams.get('probe') === '1'
  const days = Math.min(Number(url.searchParams.get('days') ?? 7), 30)

  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!probe && cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const to = new Date()
  const from = new Date(Date.now() - days * 86400_000)
  const iso = (d: Date) => d.toISOString().slice(0, 19)
  const feed = `${BASE}?publishedFrom=${iso(from)}&publishedTo=${iso(to)}&stages=award&size=100`

  const runId = probe ? '' : await startRun('uk_procurement')
  const sb = getSupabase()
  const errors: string[] = []
  let found = 0, inserted = 0, dupes = 0

  try {
    const res = await fetch(feed, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`Contracts Finder ${res.status}`)

    const json = await res.json() as { releases?: OcdsRelease[] }
    const releases = json.releases ?? []
    found = releases.length

    if (probe) {
      const sample = releases[0]
      return NextResponse.json({
        probe: true, feed,
        releases: found,
        first_release_keys: sample ? Object.keys(sample) : null,
        sample_award: sample?.awards?.[0] ?? null,
        sample_buyer: sample?.buyer ?? null,
        sample_parties: (sample?.parties ?? []).slice(0, 3),
      })
    }

    const rows: Array<Record<string, unknown>> = []

    for (const r of releases) {
      const parties = r.parties ?? []
      for (const award of r.awards ?? []) {
        const supplier = award.suppliers?.[0]
        if (!supplier?.name) continue

        const companyNo = supplierCompanyNumber(parties, supplier.id)
        const amount = award.value?.amount ?? r.tender?.value?.amount ?? null
        const buyer = r.buyer?.name ?? 'a public body'
        const title = r.tender?.title ?? award.title ?? 'Contract award'
        const value = amount
          ? `£${Number(amount).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`
          : 'an undisclosed sum'

        rows.push({
          source: 'uk_procurement',
          event_type: 'contract_award',
          event_date: (award.date ?? r.date ?? new Date().toISOString()).slice(0, 10),
          url: `https://www.contractsfinder.service.gov.uk/Notice/${r.ocid ?? ''}`,
          raw_content: {
            title: `${buyer} awarded ${value} to ${supplier.name}`,
            description:
              `${buyer} awarded a contract to ${supplier.name}` +
              (amount ? ` worth ${value}` : '') +
              `${award.date ? ` on ${award.date.slice(0, 10)}` : ''}. ` +
              `Contract: ${title}. ` +
              (r.tender?.description ? `${String(r.tender.description).slice(0, 800)} ` : '') +
              (r.tender?.classification?.description
                ? `Category: ${r.tender.classification.description}.` : ''),
            buyer,
            supplier: supplier.name,
            supplier_company_number: companyNo,
            value_gbp: amount,
            contract_title: title,
            cpv: r.tender?.classification?.id ?? null,
          },
          source_metadata: {
            ocid: r.ocid,
            award_id: award.id,
            // Same join key as the donations data — this is what lets Loro ask
            // whether a political donor also wins public contracts.
            supplier_company_number: companyNo,
            value_gbp: amount,
            buyer,
            attribution: 'Contains public sector information licensed under the Open Government Licence v3.0',
          },
          processed: false,
        })
      }
    }

    if (rows.length) {
      const urls = [...new Set(rows.map(r => r.url as string))]
      const { data: seen } = await sb
        .from('loro_source_events')
        .select('url').eq('source', 'uk_procurement').in('url', urls)
      const seenSet = new Set((seen ?? []).map(s => s.url as string))
      const fresh = rows.filter(r => !seenSet.has(r.url as string)).slice(0, 300)
      dupes = rows.length - fresh.length

      if (fresh.length) {
        const { data: ins, error } = await sb
          .from('loro_source_events').insert(fresh).select('id')
        if (error) errors.push(`insert: ${error.message}`)
        inserted = ins?.length ?? 0
      }
    }

    await completeRun(runId, { found, new: inserted, duplicate: dupes }, errors)
    return NextResponse.json({
      ok: true, releases: found, awards_parsed: rows.length,
      inserted, duplicates: dupes,
      with_company_number: rows.filter(r =>
        (r.source_metadata as Record<string, unknown>).supplier_company_number).length,
      errors: errors.slice(0, 3),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    if (!probe) await completeRun(runId, { found, new: inserted, duplicate: dupes }, [msg])
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
