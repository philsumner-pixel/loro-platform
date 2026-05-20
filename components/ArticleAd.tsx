export default function ArticleAd() {
  return (
    <div className="loro-art-ad">

      {/* Ad bar */}
      <div className="loro-art-ad-bar">
        <span className="loro-art-ad-lbl">Advertisement</span>
        <span className="loro-art-ad-close" aria-hidden="true">✕</span>
      </div>

      {/* Ad body */}
      <div className="loro-art-ad-body">

        {/* Left — brand + message */}
        <div className="loro-art-ad-left">
          <div className="loro-art-ad-brand">Adyen</div>
          <h3 className="loro-art-ad-headline">
            When EU regulations change overnight, your payments infrastructure shouldn&apos;t have to.
          </h3>
          <p className="loro-art-ad-copy">
            Adyen holds direct acquiring licences across 35+ EU markets.
            One platform, one compliance posture — no entity restructuring required.
          </p>
          <a
            className="loro-art-ad-cta"
            href="#"
            onClick={e => e.preventDefault()}
          >
            See how it works →
          </a>
        </div>

        {/* Right — proof point */}
        <div className="loro-art-ad-right">
          <div className="loro-art-ad-stat">35+</div>
          <div className="loro-art-ad-stat-lbl">
            EU markets.<br />One licence.<br />No restructuring risk.
          </div>
        </div>

      </div>
    </div>
  )
}
