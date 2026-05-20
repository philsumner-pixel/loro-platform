import TickerStrip from '@/components/TickerStrip'
import Masthead from '@/components/Masthead'
import HeroSection from '@/components/HeroSection'
import DataStrip from '@/components/DataStrip'
import ArticleGrid from '@/components/ArticleGrid'
import NewsletterSection from '@/components/NewsletterSection'
import SiteFooter from '@/components/SiteFooter'
import AdSlot from '@/components/AdSlot'
import SponsorTag from '@/components/SponsorTag'

export default function HomePage() {
  return (
    <>
      <TickerStrip />
      <Masthead />

      {/* Sub navigation */}
      <nav className="loro-subnav">
        <div className="loro-subnav-inner">
          <a href="#" className="loro-active">All</a>
          <a href="#">Payments</a>
          <a href="#">FX & Treasury</a>
          <a href="#">Banking</a>
          <a href="#">Regulation</a>
          <a href="#">Fintech Funding</a>
          <a href="#">Ownership Intel</a>
          <a href="#">Open Banking</a>
          <a href="#">On-chain</a>
        </div>
      </nav>

      <HeroSection />
      <DataStrip />

      <main>
        {/* Latest intelligence */}
        <div className="loro-wrap">
          <div className="loro-section-wrap">
            <div className="loro-section-hd" style={{ marginBottom: 1 }}>
              <span className="loro-section-title">Latest intelligence</span>
              <a className="loro-section-link" href="#">All stories →</a>
            </div>
            <ArticleGrid variant="intelligence" />
          </div>
        </div>

        {/* Sponsor slot — section sponsorship example */}
        <div className="loro-wrap">
          <div className="loro-sponsor" style={{ marginTop: 0 }}>
            <span className="loro-sponsor-lbl">
              FX corridor data partnership — sponsorship available
            </span>
            <span className="loro-sponsor-cta">Enquire →</span>
          </div>
        </div>

        {/* Teads inRead slot — homepage, between editorial grids */}
        <div className="loro-wrap">
          <AdSlot id="loro-inread-home-1" type="inread-home" />
        </div>

        {/* Markets */}
        <div className="loro-wrap">
          <div className="loro-section-wrap">
            <div className="loro-section-hd" style={{ marginBottom: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                <span className="loro-section-title">Markets</span>
                <SponsorTag name={undefined} />
              </div>
              <a className="loro-section-link" href="#">All market coverage →</a>
            </div>
            <ArticleGrid variant="markets" />
          </div>
        </div>
      </main>

      <NewsletterSection />
      <SiteFooter />
    </>
  )
}
