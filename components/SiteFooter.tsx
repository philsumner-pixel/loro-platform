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
            <a href="#">Payments</a>
            <a href="#">FX & Treasury</a>
            <a href="#">Banking</a>
            <a href="#">Regulation</a>
            <a href="#">Funding</a>
            <a href="#">On-chain</a>
          </div>

          <div className="loro-footer-col">
            <div className="loro-footer-col-title">Data</div>
            <a href="#">FX Corridor Tracker</a>
            <a href="#">Settlement Index</a>
            <a href="#">Funding Tracker</a>
            <a href="#">Ownership Intel</a>
            <a href="#">ERP Vendor Index</a>
            <a href="#">Enterprise API →</a>
          </div>

          <div className="loro-footer-col">
            <div className="loro-footer-col-title">About</div>
            <a href="#">About Loro</a>
            <a href="#">Editorial guidelines</a>
            <a href="#">Data partnerships</a>
            <a href="#">Advertise</a>
            <a href="#">Contact</a>
          </div>

        </div>

        <div className="loro-footer-bottom">
          <span className="loro-footer-legal">
            © 2026 Loro. All rights reserved. · Privacy · Terms
          </span>
          <span className="loro-footer-badge">Loro Intelligence Engine</span>
        </div>
      </div>
    </footer>
  )
}
