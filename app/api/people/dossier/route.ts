import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// One member, everything the registers say, on a single timeline.
//
// Each register publishes separately and none of it is joined. Together they
// answer a question none can alone: did a declaration, a donation, a speech and
// a vote line up on the same subject?
//
// It REPORTS. Proximity in time is not causation, and everything here is
// lawful and already public — the output is a chronology for a journalist to
// read, not a conclusion.

export const runtime = 'nodejs'
export const revalidate = 600

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const person = url.searchParams.get('person')

  try {
    const client = sb()

    // No person specified — return who is worth looking at.
    if (!person) {
      const { data } = await client.rpc('loro_dossier_candidates', { min_registers: 2 })
      interface C { person: string; registers: number; declared: number
        received: number; said: number; voted: number; total_gbp: string }
      return NextResponse.json({
        candidates: ((data ?? []) as C[]).slice(0, 60).map(c => ({
          person: c.person,
          registers: Number(c.registers),
          declared: Number(c.declared),
          received: Number(c.received),
          said: Number(c.said),
          voted: Number(c.voted),
          totalGbp: Number(c.total_gbp ?? 0),
        })),
      })
    }

    const { data, error } = await client.rpc('loro_person_dossier', { person_name: person })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    interface E { event_date: string; kind: string; headline: string; detail: string
      value_gbp: string | null; counterparty: string | null; url: string; source: string }

    const events = ((data ?? []) as E[]).map(e => ({
      date: e.event_date,
      kind: e.kind,
      headline: e.headline,
      detail: e.detail,
      value: e.value_gbp ? Number(e.value_gbp) : null,
      counterparty: e.counterparty,
      url: e.url,
      source: e.source,
    }))

    const totals = {
      declared: events.filter(e => e.kind === 'declared').length,
      received: events.filter(e => e.kind === 'received').length,
      said: events.filter(e => e.kind === 'said').length,
      voted: events.filter(e => e.kind === 'voted').length,
      money: events.reduce((a, e) => a + (e.value ?? 0), 0),
    }

    return NextResponse.json({
      person, events, totals,
      caveat: 'Every entry is drawn from a public register and reflects lawful, reported activity. Sequence is chronological; proximity in time does not imply connection.',
      attribution: 'Contains Electoral Commission Information © Electoral Commission and/or database right, and Parliamentary information licensed under the Open Parliament Licence v3.0.',
    }, { headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' } })
  } catch {
    return NextResponse.json({ events: [], error: true })
  }
}
