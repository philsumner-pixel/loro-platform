import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Who actually paid. Drill-down behind a Mekko segment: the donors, their
// totals, and the individual donations — so a reader can check the claim
// rather than take the chart's word for it.

export const runtime = 'nodejs'
export const revalidate = 600

export async function GET(req: Request) {
  const url = new URL(req.url)
  const months = Math.min(Math.max(Number(url.searchParams.get('months') ?? 12), 3), 60)
  const recipient = url.searchParams.get('recipient')
  const donorType = url.searchParams.get('donorType')

  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const [sumRes, detRes] = await Promise.all([
      sb.rpc('loro_donor_summary', {
        months, recipient_name: recipient, donor_type_name: donorType, max_rows: 60,
      }),
      sb.rpc('loro_donation_detail', {
        months, recipient_name: recipient, donor_type_name: donorType, max_rows: 200,
      }),
    ])

    interface S {
      donor: string; donations: number; total_gbp: string; largest_gbp: string
      first_seen: string; last_seen: string; company_number: string | null
      name_variants: string[] | null
    }
    interface D {
      donor: string; donor_type: string; recipient: string
      value_gbp: string; accepted: string; company_number: string | null
      donation_type: string | null
    }

    const donors = ((sumRes.data ?? []) as S[]).map(d => ({
      donor: d.donor,
      donations: Number(d.donations),
      total: Number(d.total_gbp),
      largest: Number(d.largest_gbp),
      first: d.first_seen,
      last: d.last_seen,
      companyNumber: d.company_number,
      variants: (d.name_variants ?? []).length,
    }))

    const donations = ((detRes.data ?? []) as D[]).map(d => ({
      donor: d.donor,
      donorType: d.donor_type,
      recipient: d.recipient,
      value: Number(d.value_gbp),
      accepted: d.accepted,
      companyNumber: d.company_number,
      type: d.donation_type,
    }))

    return NextResponse.json({
      recipient, donorType, months,
      donors, donations,
      total: donors.reduce((a, d) => a + d.total, 0),
      attribution: 'Contains Electoral Commission Information © Electoral Commission and/or database right',
    }, { headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' } })
  } catch {
    return NextResponse.json({ donors: [], donations: [], error: true })
  }
}
