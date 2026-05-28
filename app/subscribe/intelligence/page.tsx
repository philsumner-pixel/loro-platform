import type { Metadata } from 'next'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'Loro Intelligence - B2B Access',
  description: 'Real-time payments intelligence for institutional investors, payments professionals and M&A teams.',
}

const FEATURES = [
  { label: 'Real-time Loro Score alerts', detail: 'Notified the moment a monitored entity moves 10+ points — before the news cycle starts.' },
  { label: 'PDMR and insider intelligence', detail: 'Director transactions and PSC changes parsed to extract person, role, transaction value. The signal institutional investors track.' },
  { label: 'Cross-jurisdictional patterns', detail: 'UK FCA + EU + US SEC signals for the same entity within 72 hours — the combination that precedes material announcements.' },
  { label: 'Full entity pages and score history', detail: 'Sub-score breakdown, 30-day trend, evidence data. Not just the number — the story behind it.' },
  { label: 'Breaking story access', detail: 'Intelligence subscribers read Loro stories before weekly newsletter distribution.' },
]

export default function IntelligenceSignupPage() {
  return (
    <>
      <Masthead />
      <div className="loro-wrap" style={{ padding: '56px 0 96px' }}>
        <a href="/subscribe" style={{ fontSize: 12, color: 'var(--ink5)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 40 }}>
          &#8592; All plans
        </a>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'start' }}>

          {/* Left — product info */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--blue)', marginBottom: 12 }}>
              Early access — limited places
            </div>
            <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 'clamp(26px, 3.5vw, 34px)', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.15, marginBottom: 16 }}>
              Loro Intelligence
            </h1>
            <p style={{ fontSize: 15, color: 'var(--ink4)', lineHeight: 1.8, marginBottom: 36 }}>
              Real-time access for institutional investors, payments executives and M&amp;A professionals. The first cohort shapes the product — we are prioritising people with an active need for pre-announcement signal detection.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderTop: '1px solid var(--border)', marginBottom: 32 }}>
              {FEATURES.map(f => (
                <div key={f.label} style={{ padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{f.label}</div>
                  <div style={{ fontSize: 13, color: 'var(--ink4)', lineHeight: 1.6 }}>{f.detail}</div>
                </div>
              ))}
            </div>

            {/* Proof */}
            <div style={{ background: 'var(--paper2)', border: '1px solid var(--border)', borderLeft: '3px solid var(--blue)', padding: '20px 24px' }}>
              <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--blue)', marginBottom: 10 }}>
                Signal proof — PayPal Holdings
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>
                10.0 <span style={{ fontSize: 12, color: 'var(--ink5)' }}>/10 anomaly</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink4)', lineHeight: 1.7, margin: 0 }}>
                Cross-jurisdictional regulatory pattern detected. Major publications covered the story 48 hours later.
              </p>
            </div>
          </div>

          {/* Right — form */}
          <div>
            <div style={{ background: 'var(--blue)', padding: '36px 36px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: 24 }}>
                Request early access
              </div>

              <form action="/api/subscribe" method="POST" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <input type="hidden" name="audience_type" value="b2b" />
                <input type="hidden" name="tier" value="paid" />

                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 7 }}>
                    Work email *
                  </label>
                  <input type="email" name="email" required placeholder="you@company.com"
                    style={{ width: '100%', padding: '11px 14px', border: '1px solid rgba(255,255,255,0.15)', fontSize: 14, color: '#fff', background: 'rgba(255,255,255,0.08)', outline: 'none', fontFamily: 'inherit' }} />
                </div>

                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 7 }}>
                    Full name *
                  </label>
                  <input type="text" name="name" required placeholder="Your name"
                    style={{ width: '100%', padding: '11px 14px', border: '1px solid rgba(255,255,255,0.15)', fontSize: 14, color: '#fff', background: 'rgba(255,255,255,0.08)', outline: 'none', fontFamily: 'inherit' }} />
                </div>

                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 7 }}>
                    Organisation *
                  </label>
                  <input type="text" name="organisation" required placeholder="Company or fund"
                    style={{ width: '100%', padding: '11px 14px', border: '1px solid rgba(255,255,255,0.15)', fontSize: 14, color: '#fff', background: 'rgba(255,255,255,0.08)', outline: 'none', fontFamily: 'inherit' }} />
                </div>

                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 7 }}>
                    Role
                  </label>
                  <select name="role"
                    style={{ width: '100%', padding: '11px 14px', border: '1px solid rgba(255,255,255,0.15)', fontSize: 14, color: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.08)', outline: 'none', fontFamily: 'inherit', appearance: 'none' }}>
                    <option value="">Select your role</option>
                    <option value="institutional_investor">Institutional investor</option>
                    <option value="analyst">Research analyst</option>
                    <option value="payments_executive">Payments executive</option>
                    <option value="ma_professional">M&amp;A professional</option>
                    <option value="journalist">Journalist / editor</option>
                    <option value="regulator">Regulatory professional</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 7 }}>
                    What would you use this for?
                  </label>
                  <textarea name="interest_note" rows={3} placeholder="Optional — helps us prioritise your request"
                    style={{ width: '100%', padding: '11px 14px', border: '1px solid rgba(255,255,255,0.15)', fontSize: 13, color: '#fff', background: 'rgba(255,255,255,0.08)', outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.6 }} />
                </div>

                <button type="submit"
                  style={{ padding: '13px 24px', background: '#fff', color: 'var(--blue)', border: 'none', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
                  Request access &#8594;
                </button>

                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6, margin: 0 }}>
                  We review every request. You will hear from us within 48 hours.
                </p>
              </form>
            </div>
          </div>
        </div>
      </div>
      <SiteFooter />
    </>
  )
}
