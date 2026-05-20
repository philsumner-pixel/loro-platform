import type { Metadata } from 'next'
import TickerStrip from '@/components/TickerStrip'
import Masthead from '@/components/Masthead'
import NewsletterSection from '@/components/NewsletterSection'
import SiteFooter from '@/components/SiteFooter'
import ArticleAd from '@/components/ArticleAd'

export const metadata: Metadata = {
  title: "PayPal's EU subsidiary restructure triggers €40m PDMR disclosure obligation",
  description:
    'New entity structure means three senior executives must now file with ESMA directly — a compliance headache that signals broader regulatory intent towards US payment platforms operating across EU jurisdictions.',
}

// NewsArticle JSON-LD — tells AI crawlers and Google exactly what this is
const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'NewsArticle',
  headline: "PayPal's EU subsidiary restructure triggers €40m PDMR disclosure obligation",
  description: 'New entity structure means three senior executives must now file with ESMA directly — a compliance headache that signals broader regulatory intent towards US payment platforms operating across EU jurisdictions.',
  datePublished: '2026-05-20T09:00:00Z',
  dateModified: '2026-05-20T09:00:00Z',
  author: { '@type': 'Person', name: 'Chris Cannon', url: 'https://loro-platform.vercel.app/authors/chris-cannon' },
  publisher: {
    '@type': 'Organization',
    name: 'Loro',
    description: 'Independent payments intelligence',
    url: 'https://loro-platform.vercel.app',
    logo: { '@type': 'ImageObject', url: 'https://loro-platform.vercel.app/favicon.svg' }
  },
  articleSection: 'Ownership Intelligence',
  keywords: ['PDMR', 'PayPal', 'EU regulation', 'MAR Article 19', 'ESMA', 'insider trading', 'payment licensing'],
  about: [
    { '@type': 'Organization', name: 'PayPal', sameAs: 'https://www.wikidata.org/wiki/Q42070' },
    { '@type': 'Legislation', name: 'EU Market Abuse Regulation', alternateName: 'MAR' }
  ],
  isAccessibleForFree: false,
  mainEntityOfPage: { '@type': 'WebPage', '@id': 'https://loro-platform.vercel.app/news/paypal-eu-pdmr-disclosure' }
}

export default function PayPalPDMRArticle() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <TickerStrip />
      <Masthead />

      {/* Sub navigation */}
      <nav className="loro-subnav">
        <div className="loro-subnav-inner">
          <a href="/" className="">All</a>
          <a href="#" className="loro-active">Payments</a>
          <a href="#">FX & Treasury</a>
          <a href="#">Banking</a>
          <a href="#">Regulation</a>
          <a href="#">Fintech Funding</a>
          <a href="#">Ownership Intel</a>
          <a href="#">Open Banking</a>
          <a href="#">On-chain</a>
        </div>
      </nav>

      {/* Article */}
      <div className="loro-wrap">
        <div className="loro-article-zone">
          <div className="loro-article-content">

            {/* Header */}
            <header className="loro-art-header">
              <a href="/" className="loro-art-back">← Back to Payments</a>

              <div className="loro-art-cats">
                <span className="loro-art-cat">Payments</span>
                <span className="loro-art-cat-sep">·</span>
                <span className="loro-art-cat">Regulation</span>
                <span className="loro-art-cat-sep">·</span>
                <span className="loro-art-cat">Ownership Intelligence</span>
              </div>

              <h1 className="loro-art-headline">
                PayPal&apos;s EU subsidiary restructure triggers{' '}
                <em>€40m PDMR disclosure obligation</em>
              </h1>

              <p className="loro-art-standfirst">
                New entity structure means three senior executives must now file with
                ESMA directly — a compliance headache that signals broader regulatory
                intent towards US payment platforms operating across EU jurisdictions.
              </p>

              <div className="loro-art-meta">
                <span className="loro-art-author">Chris Cannon</span>
                <span className="loro-art-sep">·</span>
                <span className="loro-art-date">20 May 2026</span>
                <span className="loro-art-sep">·</span>
                <span className="loro-art-read">6 min read</span>
                <span className="loro-art-sep">·</span>
                <span className="loro-art-sub">Subscriber</span>
              </div>
            </header>

            {/* Intelligence engine callout */}
            <div className="loro-art-intel">
              <span className="loro-art-intel-icon">Loro Intel</span>
              <p className="loro-art-intel-text">
                The Loro intelligence engine identified this filing gap on{' '}
                <strong>17 March</strong> — eleven days before any public
                notification — by cross-referencing entity registration changes
                across four EU regulatory databases.
              </p>
            </div>

            {/* Article body */}
            <div className="loro-art-body">

              {/* ── Paragraph 1 ── */}
              <p>
                PayPal&apos;s consolidation of its European entity architecture —
                finalised across five ESMA-regulated jurisdictions in March — has
                triggered an unexpected PDMR disclosure obligation affecting three
                senior executives with combined declared interests of approximately
                €40 million. The restructure, which brought PayPal&apos;s European
                payments operations under a single Luxembourg-domiciled holding vehicle,
                activated Article 19 of the EU&apos;s Market Abuse Regulation, requiring
                direct beneficial ownership filings to national competent authorities
                rather than routing them through the parent company&apos;s existing SEC
                obligations.
              </p>

              {/* ── Teads inRead ad — flows after paragraph 1 ── */}
              <ArticleAd />

              {/* ── Paragraph 2 ── */}
              <p>
                The change matters because it closes a compliance grey area that many
                US payment multinationals have relied on, knowingly or otherwise, since
                MAR came into force in 2016. PayPal&apos;s European executives have
                historically discharged beneficial ownership disclosure through the
                group&apos;s SEC filings — an arrangement that regulators in several
                member states flagged as technically inconsistent with MAR requirements
                but never formally challenged. That tolerance appears to be narrowing.
                Two senior compliance lawyers consulted by Loro independently described
                the obligation as &ldquo;long overdue&rdquo; and said PayPal&apos;s
                response would set an observable precedent for Stripe, Block and at
                least three other large US payment platforms with structurally similar
                European holding arrangements.
              </p>

              {/* ── Paragraph 3 ── */}
              <p>
                The Loro intelligence engine identified the filing gap before any
                formal notification, cross-referencing changes to PayPal&apos;s entity
                registrations across BaFin (Germany), AFM (Netherlands) and CBI
                (Ireland) with Luxembourg RCS submissions lodged on 14 March. The three
                executives in scope — whose identities Loro is withholding pending
                confirmation of the formal PDMR filings — hold beneficial interests
                through the consolidated entity that collectively exceed the threshold
                above which ESMA member state notification is mandatory within three
                business days of any qualifying transaction.
              </p>

              {/* ── Pull quote ── */}
              <blockquote className="loro-art-pullquote">
                <p>
                  &ldquo;The restructure looks operationally motivated — almost certainly
                  connected to PayPal&apos;s European licence consolidation strategy.
                  The PDMR consequence was, in all likelihood, not the primary
                  consideration.&rdquo;
                </p>
                <cite>Brussels-based regulatory counsel, speaking on background</cite>
              </blockquote>

              {/* ── Paragraph 4 ── */}
              <p>
                Article 19 of MAR sets a €5,000 initial notification threshold,
                escalating to mandatory national-level reporting at €20,000 per
                calendar year. For executives with declared stakes in the €40 million
                range, the new obligation creates a material administrative process:
                PDMR package preparation, submission to the relevant NCAs, and an
                ongoing monitoring framework for future transactions across the
                consolidated entity. PayPal declined to respond to specific questions
                about the restructure prior to publication.
              </p>

              {/* ── Paragraph 5 ── */}
              <p>
                The broader implication is the one Loro is watching. ESMA confirmed
                to Loro that it is conducting a thematic review of PDMR compliance
                among large-cap payment companies with cross-border EU operations. The
                Authority declined to confirm whether PayPal is among the subjects of
                the review. What is clear from Loro&apos;s entity database is that the
                March consolidation is not an isolated occurrence: at least four other
                US-headquartered payment companies have undertaken structurally similar
                entity reorganisations in the eighteen months since the European Banking
                Authority published its revised guidance on payment institution
                authorisation in Q3 2024.
              </p>

              {/* ── Key data box ── */}
              <div className="loro-art-databox">
                <div className="loro-art-databox-title">Key figures</div>
                <div className="loro-art-databox-grid">
                  <div className="loro-art-databox-item">
                    <div className="loro-art-databox-val">€40m</div>
                    <div className="loro-art-databox-label">Combined beneficial interests of the three affected executives</div>
                  </div>
                  <div className="loro-art-databox-item">
                    <div className="loro-art-databox-val">Art. 19 MAR</div>
                    <div className="loro-art-databox-label">EU Market Abuse Regulation provision triggered by the restructure</div>
                  </div>
                  <div className="loro-art-databox-item">
                    <div className="loro-art-databox-val">3 days</div>
                    <div className="loro-art-databox-label">Mandatory NCA notification window from any qualifying transaction</div>
                  </div>
                  <div className="loro-art-databox-item">
                    <div className="loro-art-databox-val">11 days</div>
                    <div className="loro-art-databox-label">Ahead of public notification that Loro flagged the entity structure change</div>
                  </div>
                </div>
              </div>

              {/* ── Paragraph 6 ── */}
              <p>
                For each of those companies, the PDMR exposure analysis runs the same
                way it ran for PayPal: consolidated holding entity, senior executives
                with significant beneficial interests, a regulatory clock that started
                running at the point of registration change. The immediate consequence
                for PayPal is administrative — three PDMR packages to prepare, NCA
                submission processes to establish, and a period of heightened scrutiny
                from the relevant national competent authorities. The longer
                consequence may be more significant. Loro is monitoring their filing
                histories.
              </p>

            </div>{/* /loro-art-body */}

            {/* Article tags */}
            <div style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['PDMR', 'EU Regulation', 'PayPal', 'ESMA', 'Market Abuse Regulation', 'Ownership Intelligence'].map(tag => (
                <span key={tag} style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 20, color: 'var(--ink4)', cursor: 'pointer' }}>
                  {tag}
                </span>
              ))}
            </div>

          </div>{/* /loro-article-content */}
        </div>{/* /loro-article-zone */}

        {/* Related */}
        <div className="loro-related">
          <div className="loro-section-hd" style={{ marginBottom: 1 }}>
            <span className="loro-section-title">Related intelligence</span>
            <a className="loro-section-link" href="/">All stories →</a>
          </div>
          <div className="loro-art-grid">
            {[
              { cat: 'Ownership Intel', title: 'PDMR filings suggest coordinated pre-announcement activity at three mid-cap fintechs', excerpt: 'FCA data reveals a pattern of executive share disposals across three companies in the seven days before material announcements.', author: 'Chris Cannon', time: '3 hours ago' },
              { cat: 'Regulation', title: 'PSD3 draft: the twelve provisions that will reshape payment institution authorisation', excerpt: "Loro's regulatory analysis team identifies the dozen clauses with the most material implications for UK fintechs seeking EU market access.", author: 'Chris Cannon', time: '2 days ago' },
              { cat: 'Banking', title: 'The quiet acquisition: how Revolut assembled its EU banking licence network', excerpt: 'A deep-dive into nine months of regulatory filings, PDMR disclosures, and Companies House registrations.', author: 'Loro Intelligence', time: '2 days ago' },
            ].map((a, i) => (
              <article key={i} className="loro-art-item">
                <span className="loro-art-cat">{a.cat}</span>
                <h3 className="loro-art-title">{a.title}</h3>
                <p className="loro-art-excerpt">{a.excerpt}</p>
                <div className="loro-art-meta">
                  <span>{a.author}</span>
                  <span className="loro-art-dot">·</span>
                  <span>{a.time}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

      </div>{/* /loro-wrap */}

      <NewsletterSection />
      <SiteFooter />
    </>
  )
}
