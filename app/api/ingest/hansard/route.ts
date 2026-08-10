import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun } from '@/lib/ingest/utils'

// ── HANSARD ─────────────────────────────────────────────────────────────
// Closes the influence circuit's last gap. Loro already holds what an MP
// DECLARED (register of interests, with donor company numbers), what was GIVEN
// (Electoral Commission) and how they VOTED (Commons divisions). Hansard adds
// what they actually SAID — so a declared interest can be set against a
// contribution in the chamber, not just a vote.
//
// There is no formally documented JSON API for recent contributions, so the
// endpoint the Hansard site itself uses is probed rather than assumed.
// ?probe=1 reports which candidates respond and what shape they return.

export const runtime = 'nodejs'
export const maxDuration = 60

const UA = 'Loro Intelligence (contact: hello@loro.media)'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function candidates(term: string, from: string, to: string): string[] {
  const t = encodeURIComponent(term)
  return [
    `https://hansard-api.parliament.uk/search/contributions/Spoken.json?queryParameters.searchTerm=${t}&queryParameters.startDate=${from}&queryParameters.endDate=${to}&queryParameters.take=50`,
    `https://hansard-api.parliament.uk/search.json?queryParameters.searchTerm=${t}&queryParameters.startDate=${from}&queryParameters.endDate=${to}`,
    `https://hansard.parliament.uk/search/contributions.json?searchTerm=${t}&startDate=${from}&endDate=${to}`,
  ]
}

interface Contribution {
  ContributionExtId?: string
  MemberName?: string
  MemberId?: number
  ContributionText?: string
  ContributionTextFull?: string
  SittingDate?: string
  DebateSection?: string
  House?: string
  Section?: string
  Rank?: number
}

function asArray(payload: unknown): Contribution[] {
  if (Array.isArray(payload)) return payload as Contribution[]
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>
    for (const k of ['Results', 'Contributions', 'results', 'items', 'SearchTerms']) {
      if (Array.isArray(o[k])) return o[k] as Contribution[]
    }
    for (const v of Object.values(o)) if (Array.isArray(v)) return v as Contribution[]
  }
  return []
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const probe = url.searchParams.get('probe') === '1'
  // Parliament sits for roughly two-thirds of the year: summer recess alone runs
  // from late July to September. A 14-day window returns nothing for weeks at a
  // time, so the default reaches back far enough to survive a recess.
  const days = Math.min(Number(url.searchParams.get('days') ?? 60), 180)

  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!probe && cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)

  // Terms chosen for the beat, not for volume: these are the debates where a
  // declared interest is most likely to be material.
  const TERMS = ['payments', 'financial services', 'sanctions', 'procurement',
                 'energy prices', 'planning', 'gambling', 'cryptocurrency']

  if (probe) {
    const out: Array<Record<string, unknown>> = []
    for (const u of candidates('payments', from, to)) {
      try {
        const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' },
                                     signal: AbortSignal.timeout(20000) })
        const body = await res.text()
        let parsed: unknown = null
        try { parsed = JSON.parse(body) } catch { /* not json */ }
        const arr = parsed ? asArray(parsed) : []
        out.push({
          url: u, status: res.status,
          content_type: res.headers.get('content-type'),
          length: body.length,
          top_level_keys: parsed && !Array.isArray(parsed) ? Object.keys(parsed as object).slice(0,12) : null,
          extracted: arr.length,
          first_item_keys: arr[0] ? Object.keys(arr[0]).slice(0,20) : null,
          sample: arr[0] ?? body.slice(0, 200),
        })
        if (res.ok && arr.length) break
      } catch (e) {
        out.push({ url: u, error: e instanceof Error ? e.message.slice(0,80) : 'failed' })
      }
    }
    return NextResponse.json({ probe: true, window: [from, to], attempts: out })
  }

  const runId = await startRun('hansard')
  const sb = getSupabase()
  const errors: string[] = []
  const rows: Array<Record<string, unknown>> = []
  let found = 0, inserted = 0, dupes = 0

  try {
    for (const term of TERMS) {
      let items: Contribution[] = []
      for (const u of candidates(term, from, to)) {
        try {
          const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' },
                                       signal: AbortSignal.timeout(15000) })
          if (!res.ok) continue
          items = asArray(await res.json())
          if (items.length) break
        } catch { /* next candidate */ }
      }
      found += items.length

      for (const c of items.slice(0, 25)) {
        const id = c.ContributionExtId
        const member = c.MemberName
        const text = c.ContributionTextFull || c.ContributionText || ''
        if (!id || !member || text.length < 60) continue

        rows.push({
          source: 'hansard',
          event_type: 'parliamentary_contribution',
          event_date: (c.SittingDate ?? new Date().toISOString()).slice(0, 10),
          url: `https://hansard.parliament.uk/Commons/${(c.SittingDate ?? '').slice(0,10)}/debates/${id}`,
          raw_content: {
            title: `${member} on ${c.DebateSection ?? term}`,
            description: text.slice(0, 3000),
            member,
            debate: c.DebateSection ?? null,
            house: c.House ?? 'Commons',
            search_term: term,
          },
          source_metadata: {
            contribution_id: id,
            member_id: c.MemberId ?? null,
            debate: c.DebateSection ?? null,
            term,
            attribution: 'Contains Parliamentary information licensed under the Open Parliament Licence v3.0',
          },
          processed: false,
        })
      }
    }

    if (rows.length) {
      const ids = rows.map(r => (r.source_metadata as Record<string,unknown>).contribution_id as string)
      const { data: seen } = await sb.from('loro_source_events')
        .select('source_metadata').eq('source','hansard').limit(5000)
      const seenSet = new Set((seen ?? []).map(s =>
        (s.source_metadata as Record<string, unknown>)?.contribution_id as string))
      const fresh = rows.filter((_, i) => !seenSet.has(ids[i]))
      dupes = rows.length - fresh.length

      if (fresh.length) {
        const { data: ins, error } = await sb.from('loro_source_events')
          .insert(fresh.slice(0, 200)).select('id')
        if (error) errors.push(`insert: ${error.message}`)
        inserted = ins?.length ?? 0
      }
    }

    await completeRun(runId, { found, new: inserted, duplicate: dupes }, errors)
    return NextResponse.json({ ok: true, window: [from, to], found,
      parsed: rows.length, inserted, duplicates: dupes, errors: errors.slice(0,3) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await completeRun(runId, { found, new: inserted, duplicate: dupes }, [msg])
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
