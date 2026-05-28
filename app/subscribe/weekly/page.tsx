import type { Metadata } from 'next'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'Loro Weekly - Free Newsletter',
  description: 'The week in payments, plain English. Free every Friday.',
}

const FEATURES = [
  { label: 'Every Friday morning', detail: 'What moved, who filed, what it means — concise, no noise.' },
  { label: 'Loro Score snapshot', detail: 'Top 5 movers of the week with plain-English context.' },
  { label: 'Regulatory digest', detail: 'FCA, EU and US filings summarised — only the ones that matter.' },
  { label: 'Watchlist activity', detail: 'Which monitored entities went quiet, which got loud.' },
]

export default function WeeklySignupPage() {
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
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12 }}>
              Free newsletter
            </div>
            <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 'clamp(26px, 3.5vw, 34px)', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.15, marginBottom: 16 }}>
              Loro Weekly
            </h1>
            <p style={{ fontSize: 15, color: 'var(--ink4)', lineHeight: 1.8, marginBottom: 36 }}>
              The week in payments, plain English. What moved in the sector, who filed what, and what it might mean. Arrives every Friday morning.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderTop: '1px solid var(--border)' }}>
              {FEATURES.map(f => (
                <div key={f.label} style={{ padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{f.label}</div>
                  <div style={{ fontSize: 13, color: 'var(--ink4)', lineHeight: 1.6 }}>{f.detail}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 28, padding: '16px 20px', background: 'var(--paper2)', border: '1px solid var(--border)' }}>
              <p style={{ fontSize: 12, color: 'var(--ink5)', lineHeight: 1.7, margin: 0 }}>
                Need real-time alerts and entity page access?{' '}
                <a href="/subscribe/intelligence" style={{ color: 'var(--blue)', fontWeight: 500 }}>
                  Loro Intelligence &#8594;
                </a>
              </p>
            </div>
          </div>

          {/* Right — form */}
          <div>
            <div style={{ background: 'var(--paper2)', border: '1px solid var(--border)', padding: '36px 36px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 24 }}>
                Subscribe free
              </div>

              <form action="/api/subscribe" method="POST" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <input type="hidden" name="audience_type" value="retail" />
                <input type="hidden" name="tier" value="free" />

                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink5)', display: 'block', marginBottom: 7 }}>
                    Email address *
                  </label>
                  <input type="email" name="email" required placeholder="you@example.com"
                    style={{ width: '100%', padding: '11px 14px', border: '1px solid var(--border)', fontSize: 14, color: 'var(--ink)', background: 'var(--paper)', outline: 'none', fontFamily: 'inherit' }} />
                </div>

                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink5)', display: 'block', marginBottom: 7 }}>
                    First name
                  </label>
                  <input type="text" name="name" placeholder="Optional"
                    style={{ width: '100%', padding: '11px 14px', border: '1px solid var(--border)', fontSize: 14, color: 'var(--ink)', background: 'var(--paper)', outline: 'none', fontFamily: 'inherit' }} />
                </div>

                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink5)', display: 'block', marginBottom: 7 }}>
                    How did you find Loro?
                  </label>
                  <select name="interest_note"
                    style={{ width: '100%', padding: '11px 14px', border: '1px solid var(--border)', fontSize: 14, color: 'var(--ink4)', background: 'var(--paper)', outline: 'none', fontFamily: 'inherit', appearance: 'none' }}>
                    <option value="">Select one</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="twitter">Twitter / X</option>
                    <option value="referral">Someone referred me</option>
                    <option value="search">Search</option>
                    <option value="press">Press / article</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <button type="submit"
                  style={{ padding: '13px 24px', background: 'var(--ink)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
                  Subscribe free &#8594;
                </button>

                <p style={{ fontSize: 11, color: 'var(--ink5)', lineHeight: 1.6, margin: 0 }}>
                  No spam. Unsubscribe any time. We do not sell or share your data.
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
