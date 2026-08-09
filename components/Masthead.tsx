export default function Masthead() {
  return (
    <header className="loro-masthead">
      <div className="loro-wrap loro-masthead-inner">
        <div className="loro-logo-wrap">
          <span className="loro-logo">Loro</span>
          <span className="loro-tagline">Payments Intelligence</span>
        </div>

        <nav className="loro-mast-nav">
          <a href="/news" className="active">News</a>
          <a href="/lane/money-markets">Markets</a>
          <a href="/data">Data</a>
          <a href="/lane/ownership-control">Ownership</a>
          <a href="/intelligence">Intelligence</a>
          <a href="/lane/regulation-enforcement">Regulation</a>
        </nav>

        <div className="loro-mast-right">
          <button className="loro-btn-signin">Sign in</button>
          <a href="/subscribe" className="loro-btn-subscribe" style={{textDecoration:'none'}}>Subscribe →</a>
        </div>
      </div>
    </header>
  )
}
