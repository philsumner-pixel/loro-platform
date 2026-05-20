export default function HeroSection() {
  return (
    <section className="loro-hero-section">
      <div className="loro-wrap">
        <div className="loro-hero-grid">

          {/* Main hero article */}
          <div className="loro-hero-main">
            <span className="loro-hero-cat">Ownership Intelligence · Exclusive</span>
            <h1 className="loro-hero-headline">
              PDMR filings suggest coordinated pre-announcement
              activity at <em>three mid-cap fintechs</em>
            </h1>
            <p className="loro-hero-standfirst">
              FCA data reveals a pattern of executive share disposals across three
              companies in the seven days before material announcements — a timeline
              the Loro intelligence engine flagged before disclosures were made.
            </p>
            <div className="loro-hero-meta">
              <span className="loro-hero-byline">Chris Cannon · 3 hours ago</span>
              <span className="loro-hero-sep">·</span>
              <span className="loro-hero-read">Read the analysis →</span>
              <span className="loro-hero-sep">·</span>
              <span className="loro-hero-tag">Subscriber</span>
            </div>
          </div>

          {/* Secondary story stack */}
          <div className="loro-secondary-stack">
            <div className="loro-sec-item">
              <span className="loro-sec-cat">FX & Payments</span>
              <div className="loro-sec-title">
                SEPA Instant achieves 98.2% Eurozone uptake — what it means
                for cross-border settlement
              </div>
              <div className="loro-sec-meta">2 hours ago</div>
            </div>
            <div className="loro-sec-item">
              <span className="loro-sec-cat">Funding</span>
              <div className="loro-sec-title">
                Modulr raises £95m Series C at £600m valuation as embedded
                finance arms race intensifies
              </div>
              <div className="loro-sec-meta">4 hours ago</div>
            </div>
            <div className="loro-sec-item">
              <span className="loro-sec-cat">Regulation</span>
              <div className="loro-sec-title">
                BoE consultation on digital pound settlement rails:
                Loro&apos;s full analysis
              </div>
              <div className="loro-sec-meta">Yesterday</div>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
