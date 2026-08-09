import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Three views the entity linking makes possible: concentration, the
// cross-party donor network, and timing. All resolve through canonical_id so a
// donor counts once however their name is spelled.

export const runtime = 'nodejs'
export const revalidate = 600

export async function GET(req: Request) {
  const url = new URL(req.url)
  const months = Math.min(Math.max(Number(url.searchParams.get('months') ?? 12), 3), 60)

  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const [conc, net, time, cov] = await Promise.all([
      sb.rpc('loro_donor_concentration', { months }),
      sb.rpc('loro_donor_network', { months: Math.max(months, 24), min_recipients: 2 }),
      sb.rpc('loro_donation_timeline', { months, recipient_filter: null }),
      sb.rpc('loro_donation_coverage'),
    ])

    interface C { recipient: string; total_gbp: string; donor_count: number
      top1_pct: string; top3_pct: string; top10_pct: string
      top_donor: string; top_donor_gbp: string }
    interface N { donor: string; donor_type: string; recipient: string
      value_gbp: string; donations: number; recipient_count: number; donor_total: string }
    interface T { week: string; recipient: string; total_gbp: string; donations: number }

    const concentration = ((conc.data ?? []) as C[]).map(r => ({
      recipient: r.recipient,
      total: Number(r.total_gbp),
      donors: Number(r.donor_count),
      top1: Number(r.top1_pct),
      top3: Number(r.top3_pct),
      top10: Number(r.top10_pct),
      topDonor: r.top_donor,
      topDonorValue: Number(r.top_donor_gbp),
    }))

    const network = ((net.data ?? []) as N[]).map(r => ({
      donor: r.donor, donorType: r.donor_type, recipient: r.recipient,
      value: Number(r.value_gbp), donations: Number(r.donations),
      recipientCount: Number(r.recipient_count), donorTotal: Number(r.donor_total),
    }))

    const timeline = ((time.data ?? []) as T[]).map(r => ({
      week: r.week, recipient: r.recipient,
      total: Number(r.total_gbp), donations: Number(r.donations),
    }))

    const coverage = (cov.data ?? [])[0] as { last_complete_month?: string } | undefined

    return NextResponse.json({
      months, concentration, network, timeline,
      last_complete_month: coverage?.last_complete_month ?? null,
      attribution: 'Contains Electoral Commission Information © Electoral Commission and/or database right',
    }, { headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' } })
  } catch {
    return NextResponse.json({ concentration: [], network: [], timeline: [], error: true })
  }
}
