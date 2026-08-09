export default function SiteFooter() {
  return (
    <footer className="loro-footer">
      <div className="loro-wrap">
        <div className="loro-footer-grid">

          <div>
            <div className="loro-footer-brand">Loro</div>
            <p className="loro-footer-desc">
              Global payments intelligence — independently reported. Coverage
              across payments, FX, fintech funding, regulation and ownership
              intelligence.
            </p>
            <div className="loro-footer-badges">
              <span className="loro-footer-badge">EU-anchored</span>
              <span className="loro-footer-badge">Editorially independent</span>
            </div>
          </div>

          <div className="loro-footer-col">
            <div className="loro-footer-col-title">Coverage</div>
            <a href="/lane/ownership-control">Ownership &amp; Control</a>
            <a href="/lane/regulation-enforcement">Regulation &amp; Enforcement</a>
            <a href="/lane/money-markets">Money &amp; Markets</a>
            <a href="/lane/policy-politics">Policy &amp; Politics</a>
            <a href="/lane/energy-sustainability">Energy &amp; Sustainability</a>
            <a href="/lane/technology-infrastructure">Technology &amp; Infrastructure</a>
          </div>

          <div className="loro-footer-col">
            <div className="loro-footer-col-title">Data</div>
            <a href="/data">All data</a>
            <a href="/political-money.html">Political money</a>
            <a href="/donor-analysis.html">Who funds British politics</a>
            <a href="/signal-core.html">Signal core</a>
            <a href="/corridor-currents.html">Corridor currents</a>
            <a href="/sources">Sources &amp; licences</a>
          </div>

          <div className="loro-footer-col">
            <div className="loro-footer-col-title">About</div>
            <a href="/intelligence">How Loro works</a>
            <a href="/sources">Where our data comes from</a>
            <a href="/news">All stories</a>
          </div>

        </div>

        <div className="loro-footer-bottom">
          <span className="loro-footer-legal">
            © 2026 Loro. All rights reserved.
          </span>
          <span className="loro-footer-badge">Loro Intelligence Engine</span>
        </div>
      </div>
    </footer>
  )
}
