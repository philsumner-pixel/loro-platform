import TickerStrip from '@/components/TickerStrip'
import Masthead from '@/components/Masthead'
import HeroSection from '@/components/HeroSection'
import DataStrip from '@/components/DataStrip'
import ArticleGrid from '@/components/ArticleGrid'
import NewsletterSection from '@/components/NewsletterSection'
import ScoreWidget from '@/components/ScoreWidget'
import SiteFooter from '@/components/SiteFooter'
import AdSlot from '@/components/AdSlot'
import SponsorTag from '@/components/SponsorTag'
import FakeAd from '@/components/FakeAd'

export default function HomePage() {
  return (
    <>
      <TickerStrip />
      <Masthead />

      {/* Sub navigation */}
      <nav className="loro-subnav">
        <div className="loro-subnav-inner">
          <a href="#" className="loro-active">All</a>
          <a href="#" style={{letterSpacing:'0.01em'}}>Payments</a>
          <a href="#" style={{letterSpacing:'0.01em'}}>FX & Treasury</a>
          <a href="#" style={{letterSpacing:'0.01em'}}>Banking</a>
          <a href="#" style={{letterSpacing:'0.01em'}}>Regulation</a>
          <a href="#" style={{letterSpacing:'0.01em'}}>Ownership Intel</a>
          <a href="/intelligence" style={{marginLeft:'auto',color:'var(--ink4)',letterSpacing:'0.01em'}}>Intelligence sources →</a>
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

          <ScoreWidget />
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

        {/* Teads inRead slot — demo ad until real partner connected */}
        <div className="loro-wrap">
          <FakeAd />
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
