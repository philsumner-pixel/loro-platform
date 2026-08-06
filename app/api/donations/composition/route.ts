import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Marimekko data: width = total raised per recipient, segment height = share
// from each donor type. Shows scale and composition together.
//
// Windows END at the last fully-reported month rather than today, because
// Electoral Commission publication lags reality — parties report quarterly and
// donees monthly, so the most recent months are always under-reported. A naive
// "last 3 months" would show roughly a tenth of the real activity.

export const runtime = 'nodejs'
export const revalidate = 600

export async function GET(req: Request) {
  const url = new URL(req.url)
  const months = Math.min(Math.max(Number(url.searchParams.get('months') ?? 12), 3), 60)
  const kind = url.searchParams.get('kind') ?? 'Registered party'
  const topN = Math.min(Number(url.searchParams.get('top') ?? 10), 20)

  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const [compRes, covRes] = await Promise.all([
      sb.rpc('loro_funding_composition', { months, recipient_kind: kind, top_n: topN }),
      sb.rpc('loro_donation_coverage'),
    ])

    interface Row {
      recipient: string; donor_type: string
      value_gbp: string; donations: number
      recipient_total: string; share_pct: string
      window_start: string; window_end: string
    }
    const rows = (compRes.data ?? []) as Row[]

    const byRecipient = new Map<string, {
      name: string; total: number
      segments: Array<{ donor: string; value: number; share: number; count: number }>
    }>()

    for (const r of rows) {
      const entry = byRecipient.get(r.recipient) ?? {
        name: r.recipient, total: Number(r.recipient_total), segments: [],
      }
      entry.segments.push({
        donor: r.donor_type,
        value: Number(r.value_gbp),
        share: Number(r.share_pct),
        count: Number(r.donations),
      })
      byRecipient.set(r.recipient, entry)
    }

    const recipients = [...byRecipient.values()].sort((a, b) => b.total - a.total)
    const cov = (covRes.data ?? [])[0] as
      { last_complete_month?: string; incomplete_months?: string[] } | undefined

    return NextResponse.json({
      months, kind,
      window_start: rows[0]?.window_start ?? null,
      window_end: rows[0]?.window_end ?? null,
      last_complete_month: cov?.last_complete_month ?? null,
      excluded_months: cov?.incomplete_months ?? [],
      recipients,
      total_gbp: recipients.reduce((a, r) => a + r.total, 0),
      source: 'The Electoral Commission',
      attribution: 'Contains Electoral Commission Information © Electoral Commission and/or database right',
      caveat: 'Windows end at the last fully reported month. Electoral Commission publication lags: parties report quarterly, regulated donees monthly, so the most recent months are always incomplete.',
    }, { headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' } })
  } catch {
    return NextResponse.json({ recipients: [], error: true })
  }
}
