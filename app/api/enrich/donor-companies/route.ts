import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun } from '@/lib/ingest/utils'

// ── DONOR COMPANY RESOLUTION ────────────────────────────────────────────
// Completes the influence circuit. Until now we knew a company gave money;
// we did not know WHO IS BEHIND IT. Companies House publishes both the
// officers and the persons with significant control — the people who
// actually own or control the donor.
//
// That turns "Beacon Rock Limited donated £90,000" into "these named people
// control the company that donated £90,000", which is the question a reader
// actually has, and it is the step that makes common ownership across
// several donor companies visible.
//
// Companies House allows 600 requests per five minutes. This stays far
// inside that and processes a bounded batch per run.

export const runtime = 'nodejs'
export const maxDuration = 60

const BASE = 'https://api.company-information.service.gov.uk'
const REQUEST_GAP_MS = 260

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function ch(path: string, apiKey: string): Promise<unknown | null> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })
  await sleep(REQUEST_GAP_MS)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`CH ${res.status} ${path}`)
  return res.json()
}

interface Officer { name?: string; officer_role?: string; resigned_on?: string; appointed_on?: string }
interface Psc {
  name?: string
  kind?: string
  natures_of_control?: string[]
  ceased_on?: string
  identification?: { country_registered?: string; registration_number?: string }
}

/**
 * Record a failed resolution attempt, and dead-letter the number once it has
 * failed three times. Three rather than one because Companies House returns
 * 502 under load, and a transient outage should not permanently drop a donor.
 */
async function noteAttempt(
  sb: ReturnType<typeof getSupabase>,
  companyNumber: string,
  reason: string
) {
  const { data: existing } = await sb
    .from('loro_donor_resolution_attempts')
    .select('attempts')
    .eq('company_number', companyNumber)
    .maybeSingle()

  const attempts = (existing?.attempts ?? 0) + 1

  await sb.from('loro_donor_resolution_attempts').upsert({
    company_number: companyNumber,
    attempts,
    last_attempt_at: new Date().toISOString(),
    last_reason: reason,
    permanent: attempts >= 3,
  }, { onConflict: 'company_number' })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.COMPANIES_HOUSE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'COMPANIES_HOUSE_API_KEY not set' }, { status: 500 })
  }

  const limit = Math.min(Number(url.searchParams.get('limit') ?? 10), 25)
  const runId = await startRun('donor_resolution')
  const sb = getSupabase()
  const errors: string[] = []
  const unresolved: string[] = []
  let attempted = 0, resolved = 0

  try {
    // Donor company numbers we have not yet resolved.
    const { data: donors } = await sb.rpc('loro_donor_registry', { min_total: 0 })
    type D = { company_number: string; donor_names: string[] | null; total_gbp: number }
    const all = (donors ?? []) as D[]

    // "Known" must mean the CONTROL STRUCTURE has been fetched, not merely that
    // an entity row exists. Entities were bulk-created for every donor company
    // number, so checking loro_entities made the resolver believe it had
    // finished while no officers, PSCs or SIC codes had been retrieved — and
    // SIC codes are what the interest-to-vote relevance test depends on.
    const { data: known } = await sb
      .from('loro_source_events')
      .select('source_metadata')
      .eq('source', 'companies_house_control')
      .limit(5000)
    const knownSet = new Set(
      (known ?? [])
        .map(k => String((k.source_metadata as { company_number?: string })?.company_number ?? '').toUpperCase())
        .filter(Boolean)
    )

    // Compare PADDED to PADDED. Numbers are zero-padded to 8 characters before
    // storing, but the registry supplies them unpadded — so comparing raw
    // against stored never matched and every company was re-resolved on every
    // run, producing 261 control records for 58 companies.
    const pad = (v: string) => {
      const raw = v.toUpperCase().trim()
      return /^\d+$/.test(raw) ? raw.padStart(8, '0') : raw
    }

    // The Electoral Commission register is hand-keyed and its company numbers
    // show it: trailing query marks ("06317947 ?"), bare hyphens, and numbers
    // from other registers entirely. Strip the punctuation before deciding a
    // number is bad — "06317947 ?" is a good number wearing a typo.
    const clean = (v: string) => pad(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))

    // A number that cannot resolve has no companies_house_control event, so it
    // stayed in the queue and was retried every four hours indefinitely. Six of
    // them had been cycling since 15 August, failing the run each time.
    const { data: deadLettered } = await sb
      .from('loro_donor_resolution_attempts')
      .select('company_number')
      .eq('permanent', true)
    const deadSet = new Set((deadLettered ?? []).map(r => String(r.company_number).toUpperCase()))

    const todo = all
      .filter(d => d.company_number)
      .filter(d => !knownSet.has(pad(d.company_number)))
      .filter(d => !deadSet.has(d.company_number.toUpperCase()) && !deadSet.has(clean(d.company_number)))
      .sort((a, b) => Number(b.total_gbp) - Number(a.total_gbp))
      .slice(0, limit)

    for (const d of todo) {
      attempted++
      // Companies House numbers are 8 characters, zero-padded. The registers
      // often strip leading zeros (792807), which 404s against the API —
      // it must be 00792807. Prefixed numbers (SC, NI, OC) are already 8.
      // Use the cleaned form for the lookup: punctuation from the register is
      // the difference between a 404 and a match.
      const num = clean(d.company_number)
      try {
        type Profile = {
          company_name?: string; company_status?: string; date_of_creation?: string
          sic_codes?: string[]; registered_office_address?: Record<string, string>
        }
        let profile = await ch(`/company/${num}`, apiKey) as Profile | null
        let resolvedNum = num

        // The Electoral Commission register records Northern Irish and Scottish
        // companies by their bare digits, dropping the NI/SC prefix that
        // Companies House requires. "Republican Merchandising" is filed as
        // 376645; Companies House holds it only as NI376645. Retry the
        // prefixes before giving up — two extra calls, and only on a miss.
        if (!profile && /^\d{8}$/.test(num)) {
          for (const prefix of ['NI', 'SC'] as const) {
            const candidate = `${prefix}${num.slice(2)}`
            profile = await ch(`/company/${candidate}`, apiKey) as Profile | null
            if (profile) { resolvedNum = candidate; break }
          }
        }

        if (!profile) {
          // Not an error — Companies House genuinely has no such company. Record
          // the attempt so the queue drains instead of retrying it forever, and
          // dead-letter it after three tries.
          unresolved.push(`${num}: not in Companies House`)
          await noteAttempt(sb, num, 'not in Companies House')
          continue
        }

        const [officersRes, pscRes] = await Promise.all([
          ch(`/company/${resolvedNum}/officers?items_per_page=35`, apiKey).catch(() => null),
          ch(`/company/${resolvedNum}/persons-with-significant-control?items_per_page=25`, apiKey).catch(() => null),
        ])

        const officers = ((officersRes as { items?: Officer[] } | null)?.items ?? [])
          .filter(o => !o.resigned_on)
          .map(o => ({ name: o.name, role: o.officer_role, appointed: o.appointed_on }))

        const pscs = ((pscRes as { items?: Psc[] } | null)?.items ?? [])
          .filter(p => !p.ceased_on)
          .map(p => ({
            name: p.name,
            kind: p.kind,
            control: p.natures_of_control,
            registration_number: p.identification?.registration_number,
          }))

        // Upsert the donor as an entity so it joins the graph. This silently
        // failed for weeks: there was no unique index on companies_house_id, so
        // onConflict had nothing to match, the upsert errored, and entity_id
        // was written null — leaving every UK event unattached to the entity
        // graph and the cross-source signal permanently silent. The error is
        // now surfaced rather than swallowed.
        const { data: ent, error: entErr } = await sb
          .from('loro_entities')
          .upsert({
            name: profile.company_name ?? (d.donor_names ?? [])[0] ?? num,
            entity_type: 'company',
            jurisdiction: 'UK',
            companies_house_id: num,
            notes: 'Political donor — resolved from Companies House',
          }, { onConflict: 'companies_house_id' })
          .select('id')
          .single()

        if (entErr || !ent?.id) {
          errors.push(`${num}: entity upsert failed — ${entErr?.message ?? 'no id returned'}`)
        }

        // Record the control structure as a source event so it enters the
        // corpus, gets embedded, and can be clustered alongside everything else.
        await sb.from('loro_source_events').insert({
          source: 'companies_house_control',
          event_type: 'donor_control_structure',
          entity_id: ent?.id ?? null,
          event_date: new Date().toISOString().slice(0, 10),
          url: `https://find-and-update.company-information.service.gov.uk/company/${num}`,
          raw_content: {
            title: `${profile.company_name ?? num}: ownership and control`,
            description:
              `${profile.company_name ?? num} (company ${num}), incorporated ` +
              `${profile.date_of_creation ?? 'unknown'}, status ${profile.company_status ?? 'unknown'}. ` +
              (officers.length
                ? `Current officers: ${officers.map(o => `${o.name} (${o.role})`).join('; ')}. `
                : 'No current officers listed. ') +
              (pscs.length
                ? `Persons with significant control: ${pscs.map(p =>
                    `${p.name}${p.control?.length ? ` — ${p.control.join(', ')}` : ''}`).join('; ')}.`
                : 'No persons with significant control listed.'),
            company_number: resolvedNum,
            company_status: profile.company_status,
            officers,
            pscs,
          },
          source_metadata: {
            // knownSet is built from this field, so it must stay the padded form
            // the registry supplies. Storing the prefixed number here would
            // stop the record ever matching its own queue entry, and the
            // company would be re-resolved on every run.
            company_number: num,
            companies_house_number: resolvedNum,
            donor_total_gbp: d.total_gbp,
            officer_count: officers.length,
            psc_count: pscs.length,
            sic_codes: profile.sic_codes ?? null,
          },
          processed: false,
        })

        resolved++
      } catch (e) {
        errors.push(`${num}: ${e instanceof Error ? e.message.slice(0, 60) : 'failed'}`)
      }
    }

    // A company Companies House does not hold is a fact about the register,
    // not a fault in the run — it goes to notes. But if a whole batch fails to
    // resolve, that is the "runs fine and produces nothing" pattern again, so
    // escalate it to a real error rather than logging six quiet notes.
    if (attempted >= 3 && resolved === 0 && unresolved.length === attempted) {
      errors.push(
        `all ${attempted} lookups unresolved — check COMPANIES_HOUSE_API_KEY and number normalisation`
      )
    }

    await completeRun(
      runId,
      { found: attempted, new: resolved, duplicate: 0 },
      errors,
      unresolved
    )
    return NextResponse.json({
      ok: true,
      donor_companies_known: all.length,
      attempted, resolved,
      unresolved: unresolved.length,
      remaining: Math.max(0, all.length - knownSet.size - resolved),
      errors: errors.slice(0, 5),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await completeRun(runId, { found: attempted, new: resolved, duplicate: 0 }, [msg])
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
