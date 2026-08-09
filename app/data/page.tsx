import type { Metadata } from 'next'
import TickerStrip from '@/components/TickerStrip'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'
import LaneNav from '@/components/LaneNav'

// Hub for the data-visualisation pages.
//
// Those pages are static HTML in public/ with their own dark visual language —
// deliberately different from the light article design. This page sits in the
// paper design system and acts as the doorway, so the visuals stay immersive
// and full-bleed while remaining discoverable, linked and crawlable. The
// descriptions here are also what an answer engine reads, since a canvas is
// invisible to it.

export const metadata: Metadata = {
  title: 'Data — Loro',
  description:
    'Interactive analyses built from primary sources: where political money comes from, how concentrated party funding is, and which registers feed the Loro engine.',
}

interface Viz {
  href: string
  eyebrow: string
  title: string
  blurb: string
  finding?: string
  source: string
}

const VIZ: Viz[] = [
  {
    href: '/political-money.html',
    eyebrow: 'Political finance',
    title: 'Political money',
    blurb:
      'Every donation reported to the Electoral Commission, flowing from the type of donor to the recipient — and a breakdown of how each party is funded. Click any party to filter, then any segment to see the individual payments behind it.',
    finding: 'Reform UK raised 91% of its money from individual donors; Labour 37%, with another 37% from trade unions.',
    source: 'The Electoral Commission',
  },
  {
    href: '/donor-analysis.html',
    eyebrow: 'Political finance',
    title: 'Who funds British politics',
    blurb:
      'Not just where party money comes from, but how few people it comes from — plus the donors who give across party lines, and when the money arrives. Possible only once each donor resolves to a single identity however their name is spelled.',
    finding: 'One donor accounts for 59% of Reform UK’s £25.4m. The Liberal Democrats’ largest gives 25%, across 270 donors.',
    source: 'The Electoral Commission',
  },
  {
    href: '/signal-core.html',
    eyebrow: 'The engine',
    title: 'Signal core',
    blurb:
      'A live map of the primary registers feeding Loro, drawn from the same source registry that powers the newsroom. Connect a source and it appears here.',
    source: 'Loro source registry',
  },
  {
    href: '/corridor-currents.html',
    eyebrow: 'Payments',
    title: 'Corridor currents',
    blurb:
      'Cross-border payment corridors as flowing currents — source hub to corridor class to destination market.',
    finding: 'Structure is real; volumes are illustrative pending a live feed.',
    source: 'Loro corridor model',
  },
]

export default function DataPage() {
  return (
    <>
      <TickerStrip />
      <Masthead />
      <LaneNav />

      <main className="loro-datahub">
        <header>
          <h1>Data</h1>
          <p>
            Interactive analyses built from primary sources. Each one is assembled from the same
            registers the newsroom reads — the underlying records, and the licence they are
            published under, are listed on <a href="/sources">sources</a>.
          </p>
        </header>

        <div className="loro-datahub-grid">
          {VIZ.map(v => (
            <a key={v.href} href={v.href} className="loro-datahub-card">
              <span className="eyebrow">{v.eyebrow}</span>
              <h2>{v.title}</h2>
              <p className="blurb">{v.blurb}</p>
              {v.finding && <p className="finding">{v.finding}</p>}
              <span className="src">{v.source} →</span>
            </a>
          ))}
        </div>

        <p className="loro-datahub-note">
          These pages are interactive and open full-screen. Donations are lawful and shown as a
          matter of public record; windows end at the last fully reported month because the
          Electoral Commission publishes on a delay. Contains Electoral Commission Information
          © Electoral Commission and/or database right.
        </p>
      </main>

      <SiteFooter />
    </>
  )
}
