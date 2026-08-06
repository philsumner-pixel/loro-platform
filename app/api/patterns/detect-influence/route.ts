import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun } from '@/lib/ingest/utils'

// ── INFLUENCE DETECTOR ──────────────────────────────────────────────────
// Turns the cross-register join into story candidates a journalist actually
// sees. Without this the leads sit in SQL and nobody reads them.
//
// Three signals, each a QUESTION rather than an allegation. Everything here
// is a lead requiring verification — a company giving to several parties is
// entirely legal, and the standfirst says so. The value is that the machine
// surfaced a specific, checkable thread out of thousands of records.

export const runtime = 'nodejs'
export const maxDuration = 60

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface DonorRow {
  company_number: string
  donor_names: string[] | null
  total_gbp: number
  donation_count: number
  recipients: string[] | null
  first_seen: string
  last_seen: string
}

interface CrossRow {
  company_number: string
  donor_names: string[] | null
  ec_count: number; ec_total: number
  parl_count: number; parl_total: number
  ec_recipients: string[] | null
  parl_members: string[] | null
  status: string
}

const gbp = (n: number) => `£${Number(n).toLocaleString('en-GB')}`

/**
 * Dedupe on SUBJECT, not headline. A donor can trigger several signals —
 * multi_recipient AND cross_register — which produced two candidates for the
 * same company. The extra signal is now recorded on the existing candidate.
 */
async function alreadyOpen(
  sb: ReturnType<typeof getSupabase>,
  headline: string,
  subjectKey?: string | null,
  signal?: string
): Promise<boolean> {
  const key = (subjectKey ?? headline.split(':')[0])
    .toLowerCase().replace(/[^a-z0-9]/g, '')

  const { data: existing } = await sb
    .from('loro_story_candidates')
    .select('id, merged_signals')
    .eq('subject_key', key)
    .in('status', ['new', 'shortlisted', 'in_draft'])
    .limit(1)

  if (existing?.length) {
    const merged = (existing[0].merged_signals ?? []) as unknown[]
    await sb.from('loro_story_candidates')
      .update({ merged_signals: [...merged, { headline, signal: signal ?? null }] })
      .eq('id', existing[0].id)
    return true
  }
  return false
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startRun('influence_detector')
  const sb = getSupabase()
  const errors: string[] = []
  const created: string[] = []
  let considered = 0

  try {
    // ── SIGNAL 1: a donor giving to MULTIPLE parties ──────────────────
    // Legal and not uncommon, but worth a look — it's a different posture
    // from backing one party, and the pattern is invisible unless you join
    // on the company number.
    const { data: donors } = await sb.rpc('loro_donor_registry', { min_total: 25000 })

    for (const d of ((donors ?? []) as DonorRow[]).slice(0, 40)) {
      const recipients = (d.recipients ?? []).filter(Boolean)
      if (recipients.length < 2) continue
      considered++

      const name = (d.donor_names ?? [])[0] ?? `Company ${d.company_number}`
      const headline = `${name} has donated to ${recipients.length} different recipients`
      if (await alreadyOpen(sb, headline, d.company_number, 'multi_recipient_donor')) continue

      const { error } = await sb.from('loro_story_candidates').insert({
        headline,
        subject_key: d.company_number.toLowerCase().replace(/[^a-z0-9]/g, ''),
        standfirst:
          `Electoral Commission records show ${name} (company number ${d.company_number}) ` +
          `made ${d.donation_count} donations totalling ${gbp(d.total_gbp)} between ` +
          `${d.first_seen} and ${d.last_seen}, to: ${recipients.join('; ')}. ` +
          `Donating to more than one recipient is lawful and reported here as a matter of record; ` +
          `the pattern is only visible when donations are joined on the donor's company number.`,
        category: 'Regulation',
        lane_slug: 'policy-politics',
        anomaly_score: Math.min(10, 5 + recipients.length),
        status: 'new',
        novelty_status: 'unchecked',
        detected_at: new Date().toISOString(),
        evidence_packet: {
          signal: 'multi_recipient_donor',
          company_number: d.company_number,
          donor_names: d.donor_names,
          total_gbp: d.total_gbp,
          donation_count: d.donation_count,
          recipients,
          window: [d.first_seen, d.last_seen],
          verification_needed: [
            'Confirm the donations against the Electoral Commission register entry',
            'Check Companies House for the donor\'s directors and persons of significant control',
            'Establish whether the recipients sit on opposing sides of any relevant vote',
          ],
        },
      })
      if (error) errors.push(`multi: ${error.message}`)
      else created.push(headline)
    }

    // ── SIGNAL 2: donor appears in BOTH registers ─────────────────────
    // Corroboration, and the starting point for checking whether what was
    // declared matches what was given.
    const { data: cross } = await sb.rpc('loro_register_crosscheck')

    for (const c of ((cross ?? []) as CrossRow[]).slice(0, 30)) {
      if (c.status !== 'in both registers') continue
      considered++

      const name = (c.donor_names ?? [])[0] ?? `Company ${c.company_number}`
      const members = (c.parl_members ?? []).filter(Boolean)
      const parties = (c.ec_recipients ?? []).filter(Boolean)
      const headline = `${name} appears in both the donations register and MPs' declared interests`
      if (await alreadyOpen(sb, headline, c.company_number, 'cross_register_donor')) continue

      const { error } = await sb.from('loro_story_candidates').insert({
        headline,
        subject_key: c.company_number.toLowerCase().replace(/[^a-z0-9]/g, ''),
        standfirst:
          `${name} (company number ${c.company_number}) appears in both public registers: ` +
          `the Electoral Commission records ${c.ec_count} donation(s) totalling ${gbp(c.ec_total)} ` +
          `to ${parties.join('; ') || 'recipients'}, while the Register of Members' Financial ` +
          `Interests records ${c.parl_count} declaration(s) totalling ${gbp(c.parl_total)} ` +
          `by ${members.join('; ') || 'members'}. Appearing in both registers is expected where ` +
          `a company gives to both a party and an individual member; the figures and dates need ` +
          `checking against each register before drawing any conclusion.`,
        category: 'Regulation',
        lane_slug: 'policy-politics',
        anomaly_score: 7.5,
        status: 'new',
        novelty_status: 'unchecked',
        detected_at: new Date().toISOString(),
        evidence_packet: {
          signal: 'cross_register_donor',
          company_number: c.company_number,
          donor_names: c.donor_names,
          electoral_commission: { count: c.ec_count, total_gbp: c.ec_total, recipients: parties },
          declared_interests: { count: c.parl_count, total_gbp: c.parl_total, members },
          verification_needed: [
            'Compare the dates and amounts in each register — they measure different things',
            'Confirm whether the party donation and the member declaration are the same money',
            'Check the member\'s voting record for divisions touching the donor\'s sector',
          ],
        },
      })
      if (error) errors.push(`cross: ${error.message}`)
      else created.push(headline)
    }

    // ── SIGNAL 3: concentrated giving ─────────────────────────────────
    // A single company making many separate donations to one recipient.
    for (const d of ((donors ?? []) as DonorRow[]).slice(0, 40)) {
      if (d.donation_count < 8) continue
      const recipients = (d.recipients ?? []).filter(Boolean)
      if (recipients.length !== 1) continue
      considered++

      const name = (d.donor_names ?? [])[0] ?? `Company ${d.company_number}`
      const headline = `${name}: ${d.donation_count} separate donations to ${recipients[0]}`
      if (await alreadyOpen(sb, headline, d.company_number, 'concentrated_donor')) continue

      const { error } = await sb.from('loro_story_candidates').insert({
        headline,
        subject_key: d.company_number.toLowerCase().replace(/[^a-z0-9]/g, ''),
        standfirst:
          `${name} (company number ${d.company_number}) made ${d.donation_count} separate ` +
          `donations totalling ${gbp(d.total_gbp)} to ${recipients[0]} between ${d.first_seen} ` +
          `and ${d.last_seen}. Repeated smaller donations are lawful and routinely reported; ` +
          `the cadence and the corporate ownership behind the donor are the questions worth asking.`,
        category: 'Regulation',
        lane_slug: 'policy-politics',
        anomaly_score: Math.min(10, 5 + d.donation_count / 4),
        status: 'new',
        novelty_status: 'unchecked',
        detected_at: new Date().toISOString(),
        evidence_packet: {
          signal: 'concentrated_donor',
          company_number: d.company_number,
          donor_names: d.donor_names,
          total_gbp: d.total_gbp,
          donation_count: d.donation_count,
          recipient: recipients[0],
          window: [d.first_seen, d.last_seen],
          verification_needed: [
            'Check Companies House for who controls the donor',
            'Establish whether the donations cluster around any particular date or event',
          ],
        },
      })
      if (error) errors.push(`conc: ${error.message}`)
      else created.push(headline)
    }

    await completeRun(runId, { found: considered, new: created.length, duplicate: 0 }, errors)
    return NextResponse.json({
      ok: true,
      signals_considered: considered,
      candidates_created: created.length,
      created: created.slice(0, 12),
      errors: errors.slice(0, 3),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await completeRun(runId, { found: considered, new: created.length, duplicate: 0 }, [msg])
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
