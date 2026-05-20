export default function Masthead() {
  return (
    <header className="loro-masthead">
      <div className="loro-wrap loro-masthead-inner">
        <div className="loro-logo-wrap">
          <span className="loro-logo">Loro</span>
          <span className="loro-tagline">Payments Intelligence</span>
        </div>

        <nav className="loro-mast-nav">
          <a href="#" className="active">News</a>
          <a href="#">Markets</a>
          <a href="#">FX Tracker</a>
          <a href="#">Funding</a>
          <a href="#">Intelligence</a>
          <a href="#">Regulation</a>
        </nav>

        <div className="loro-mast-right">
          <button className="loro-btn-signin">Sign in</button>
          <button className="loro-btn-subscribe">Subscribe →</button>
        </div>
      </div>
    </header>
  )
}
