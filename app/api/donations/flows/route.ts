import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Donation flows: donor type -> recipient, for the Sankey.
// Aggregation happens in SQL (loro_donation_flows) so this stays a transport
// layer and the visual stays a rendering concern.

export const runtime = 'nodejs'
export const revalidate = 600

export async function GET(req: Request) {
  const url = new URL(req.url)
  const months = Math.min(Number(url.searchParams.get('months') ?? 12), 60)
  const minFlow = Math.max(Number(url.searchParams.get('min') ?? 25000), 0)

  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const [flowsRes, totalsRes] = await Promise.all([
      sb.rpc('loro_donation_flows', { months, min_flow: minFlow }),
      sb.rpc('loro_donation_totals', { months }),
    ])

    interface Flow { donor_type: string; recipient: string; total_gbp: string; donations: number; avg_gbp: string }
    interface Total { kind: string; name: string; total_gbp: string; donations: number }

    const flows = ((flowsRes.data ?? []) as Flow[]).map(f => ({
      from: f.donor_type,
      to: f.recipient,
      value: Number(f.total_gbp),
      count: Number(f.donations),
      avg: Number(f.avg_gbp),
    }))

    const totals = (totalsRes.data ?? []) as Total[]
    const donors = totals.filter(t => t.kind === 'donor_type')
      .map(t => ({ name: t.name, value: Number(t.total_gbp), count: Number(t.donations) }))
    const recipients = totals.filter(t => t.kind === 'recipient')
      .map(t => ({ name: t.name, value: Number(t.total_gbp), count: Number(t.donations) }))

    return NextResponse.json({
      months,
      flows,
      donors,
      recipients,
      total_gbp: donors.reduce((a, d) => a + d.value, 0),
      total_donations: donors.reduce((a, d) => a + d.count, 0),
      source: 'The Electoral Commission',
      attribution: 'Contains Electoral Commission Information © Electoral Commission and/or database right',
    }, { headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' } })
  } catch {
    return NextResponse.json({ flows: [], donors: [], recipients: [], error: true })
  }
}
