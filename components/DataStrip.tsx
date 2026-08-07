import { createClient } from '@supabase/supabase-js'

// Live figures from Loro's own ingest.
//
// This strip previously carried entirely fabricated numbers — an invented
// Modulr Series C, a "Settlement Index 8.2s" (a figure we established was not
// real), and a Barclays CFO share sale. Sitting under the masthead labelled
// "LIVE DATA", that is the most damaging kind of placeholder. Everything here
// now comes from a source in the registry and says where it came from.

interface Metric {
  eyebrow: string
  sub: string
  value: string
  change?: string
  changeDir?: 'up' | 'down'
  note: string
}

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

const money = (v: number) =>
  v >= 1e6 ? `£${(v / 1e6).toFixed(1)}m` : v >= 1e3 ? `£${Math.round(v / 1e3)}k` : `£${Math.round(v)}`

async function getMetrics(): Promise<Metric[]> {
  const out: Metric[] = []
  try {
    const client = sb()

    // 1. ECB reference rate — from our own ECB ingest.
    const { data: ecb } = await client
      .from('loro_source_events')
      .select('raw_content')
      .eq('source', 'ecb_data')
      .order('event_date', { ascending: false })
      .limit(20)

    const fx = (ecb ?? []).find(r => {
      const s = (r.raw_content as { series?: string })?.series ?? ''
      return s.toLowerCase().includes('pound sterling')
    })?.raw_content as { value?: number; previous?: number; period?: string } | undefined

    if (fx?.value) {
      const chg = fx.previous ? fx.value - fx.previous : 0
      out.push({
        eyebrow: 'FX reference', sub: 'EUR / GBP',
        value: fx.value.toFixed(4),
        change: chg ? `${chg > 0 ? '↑' : '↓'} ${Math.abs(chg).toFixed(4)}` : undefined,
        changeDir: chg > 0 ? 'up' : 'down',
        note: `ECB reference rate · ${fx.period ?? ''}`,
      })
    }

    // 2. Largest political donation in the corpus.
    const { data: don } = await client
      .from('loro_source_events')
      .select('raw_content, source_metadata')
      .eq('source', 'electoral_commission')
      .order('event_date', { ascending: false })
      .limit(400)

    const biggest = (don ?? [])
      .map(d => ({
        rc: d.raw_content as { donor?: string; donee?: string },
        v: Number((d.source_metadata as { value_gbp?: number })?.value_gbp ?? 0),
      }))
      .sort((a, b) => b.v - a.v)[0]

    if (biggest?.v) {
      out.push({
        eyebrow: 'Political funding', sub: biggest.rc?.donee ?? 'Reported donation',
        value: money(biggest.v),
        note: `${biggest.rc?.donor ?? 'Donor'} · Electoral Commission`,
      })
    }

    // 3. Grid carbon intensity — National Grid ESO.
    const { data: grid } = await client
      .from('loro_source_events')
      .select('raw_content, event_date')
      .eq('source', 'carbon_intensity')
      .order('event_date', { ascending: false })
      .limit(1)

    const g = grid?.[0]?.raw_content as
      { avg_intensity?: number; renewables_pct?: number } | undefined
    if (g?.avg_intensity) {
      out.push({
        eyebrow: 'GB grid', sub: 'Carbon intensity',
        value: `${g.avg_intensity}g`,
        note: `CO2/kWh · renewables ${g.renewables_pct ?? '—'}% · National Grid ESO`,
      })
    }

    // 4. Corpus scale — what the engine is actually reading.
    const { count: events } = await client
      .from('loro_source_events')
      .select('id', { count: 'exact', head: true })
    const { data: srcs } = await client
      .from('loro_source_registry').select('slug').eq('is_active', true)

    if (events) {
      out.push({
        eyebrow: 'Loro engine', sub: 'Primary records held',
        value: events.toLocaleString(),
        note: `${(srcs ?? []).length} live sources · see /sources`,
      })
    }
  } catch {
    // Strip is non-critical.
  }
  return out
}

export default async function DataStrip() {
  const metrics = await getMetrics()
  if (!metrics.length) return null

  return (
    <div className="loro-data-strip">
      <div className="loro-wrap">
        <div className="loro-data-lbl">Live data</div>
        <div className="loro-data-widgets">
          {metrics.map(m => (
            <div className="loro-dw" key={m.eyebrow}>
              <div className="loro-dw-eye">{m.eyebrow}</div>
              <div className="loro-dw-sub">{m.sub}</div>
              <div className="loro-dw-row">
                <span className="loro-dw-val" style={{ fontSize: 20 }}>{m.value}</span>
                {m.change && (
                  <span className={`loro-dw-chg ${m.changeDir === 'up' ? 'loro-dw-up' : 'loro-dw-dn'}`}>
                    {m.change}
                  </span>
                )}
              </div>
              <div className="loro-dw-note">{m.note}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
