'use client'

export default function FakeAd() {
  return (
    <div className="loro-demo-ad">

      {/* Ad bar */}
      <div className="loro-demo-ad-bar">
        <span className="loro-demo-ad-lbl">Advertisement</span>
        <span className="loro-demo-ad-close" aria-hidden="true">✕</span>
      </div>

      {/* Ad body */}
      <div className="loro-demo-ad-body">

        {/* Left — brand text */}
        <div className="loro-demo-ad-left">
          <div className="loro-demo-ad-brand">Currencycloud</div>
          <span className="loro-demo-ad-subbrand">A Visa Solution</span>

          <h3 className="loro-demo-ad-headline">
            The FX infrastructure behind the world&apos;s fastest-growing fintechs
          </h3>
          <p className="loro-demo-ad-copy">
            Embedded cross-border payment APIs, live rates and global settlement
            infrastructure — powering Revolut, Starling, and hundreds more
            across 35+ currencies.
          </p>

          <a className="loro-demo-ad-cta" href="#" onClick={e => e.preventDefault()}>
            Explore the API →
          </a>
        </div>

        {/* Right — live rate context */}
        <div className="loro-demo-ad-right">
          <div className="loro-demo-ad-right-eye">Live corridors</div>

          <div className="loro-demo-ad-rates">
            <div className="loro-demo-ad-rate">
              <span className="loro-demo-ad-pair">GBP / EUR</span>
              <div className="loro-demo-ad-rate-row">
                <span className="loro-demo-ad-val">1.1756</span>
                <span className="loro-demo-ad-chg loro-demo-up">↑ +0.20%</span>
              </div>
            </div>
            <div className="loro-demo-ad-rate">
              <span className="loro-demo-ad-pair">GBP / USD</span>
              <div className="loro-demo-ad-rate-row">
                <span className="loro-demo-ad-val">1.2634</span>
                <span className="loro-demo-ad-chg loro-demo-dn">↓ −0.12%</span>
              </div>
            </div>
            <div className="loro-demo-ad-rate">
              <span className="loro-demo-ad-pair">GBP / INR</span>
              <div className="loro-demo-ad-rate-row">
                <span className="loro-demo-ad-val">106.32</span>
                <span className="loro-demo-ad-chg loro-demo-up">↑ +0.08%</span>
              </div>
            </div>
          </div>

          <span className="loro-demo-ad-source">
            ECB mid-market · Updated daily
          </span>
        </div>

      </div>
    </div>
  )
}
