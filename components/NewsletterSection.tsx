'use client'

export default function NewsletterSection() {
  return (
    <section className="loro-nl">
      <div className="loro-wrap">
        <div className="loro-nl-grid">
          <div>
            <div className="loro-nl-eye">Loro Intelligence</div>
            <h2 className="loro-nl-title">Intelligence in your inbox</h2>
            <p className="loro-nl-desc">
              Weekly briefing on payments, fintech and FX. Live data alerts
              when ownership movements and funding rounds break.
              Free to subscribe.
            </p>
          </div>
          <div>
            <div className="loro-nl-form">
              <input
                type="email"
                placeholder="your@email.com"
                className="loro-nl-input"
              />
              <button className="loro-nl-btn">Subscribe free →</button>
            </div>
            <p className="loro-nl-note">
              No spam. Unsubscribe at any time. Privacy policy applies.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
