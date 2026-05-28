import type { Metadata } from 'next'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'Subscribe - Loro Payment Intelligence',
  description: 'Independent payments intelligence. Weekly digest free. Real-time institutional access available.',
}

const WEEKLY_FEATURES = [
  'Weekly roundup of what moved in payments',
  'Plain-English breakdown of regulatory signals',
  'Loro Score weekly snapshot — top 5 movers',
  'Company watchlist: who is active, who is quiet',
]

const INTEL_FEATURES = [
  'Real-time Loro Score alerts (10+ point moves)',
  'PDMR and insider transaction signal detection',
  'Cross-jurisdictional pattern intelligence',
  'Entity pages with full score breakdown and history',
  'Breaking story access before newsletter',
  'API access for workflow integration',
]

export default function SubscribePage() {
  return (
    <>
      <Masthead />
      <div className="loro-wrap" style={{ padding: '64px 0 96px' }}>

        {/* Header */}
        <div style={{ maxWidth: 600, marginBottom: 56 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink5)', marginBottom: 14 }}>
            Loro Payment Intelligence
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.15, marginBottom: 18 }}>
            Two products.<br />One intelligence layer.
          </h1>
          <p style={{ fontSize: 15, color: 'var(--ink4)', lineHeight: 1.8 }}>
            Loro monitors regulatory filings, insider transactions, and sentiment signals across the payments sector. The story is the same. How you receive it depends on what you do with it.
          </p>
        </div>

        {/* Two-track cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 1, background: 'var(--border)', marginBottom: 48 }}>

          {/* Weekly */}
          <div style={{ background: 'var(--paper)', padding: '36px 40px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'inline-block', fontSize: 9, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--green)', background: 'var(--green-bg)', border: '1px solid #C2E8CF', padding: '3px 10px', marginBottom: 16 }}>
                Free
              </div>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 700, color: 'var(--ink)', marginBottom: 10, lineHeight: 1.2 }}>
                Loro Weekly
              </h2>
              <p style={{ fontSize: 14, color: 'var(--ink4)', lineHeight: 1.7 }}>
                The week in payments, plain English. What moved, who filed, what it means. Every Friday morning.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32, flex: 1 }}>
              {WEEKLY_FEATURES.map(f => (
                <div key={f} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--green)', fontSize: 13, lineHeight: 1.6, flexShrink: 0 }}>&#10003;</span>
                  <span style={{ fontSize: 13, color: 'var(--ink3)', lineHeight: 1.6 }}>{f}</span>
                </div>
              ))}
            </div>

            <a href="/subscribe/weekly" style={{ display: 'block', textAlign: 'center', padding: '12px 24px', background: 'var(--ink)', color: '#fff', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none' }}>
              Subscribe free
            </a>
          </div>

          {/* Intelligence */}
          <div style={{ background: 'var(--blue)', padding: '36px 40px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'inline-block', fontSize: 9, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.2)', padding: '3px 10px', marginBottom: 16 }}>
                Early access
              </div>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 700, color: '#fff', marginBottom: 10, lineHeight: 1.2 }}>
                Loro Intelligence
              </h2>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.7 }}>
                Real-time signal access for institutional investors, payments executives and M&amp;A professionals. First cohort, limited places.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32, flex: 1 }}>
              {INTEL_FEATURES.map(f => (
                <div key={f} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, lineHeight: 1.6, flexShrink: 0 }}>&#10003;</span>
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6 }}>{f}</span>
                </div>
              ))}
            </div>

            <a href="/subscribe/intelligence" style={{ display: 'block', textAlign: 'center', padding: '12px 24px', background: '#fff', color: 'var(--blue)', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none' }}>
              Request access
            </a>
          </div>
        </div>

        {/* Proof */}
        <div style={{ background: 'var(--paper2)', border: '1px solid var(--border)', borderLeft: '3px solid var(--blue)', padding: '28px 36px', maxWidth: 680 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--blue)', marginBottom: 12 }}>
            Recent signal
          </div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 17, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.4, marginBottom: 10 }}>
            PayPal Holdings: Loro Score 10.0 anomaly detected 48 hours before publication
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink4)', lineHeight: 1.75 }}>
            Cross-jurisdictional regulatory filings from the EU and FCA, combined with an insider disposal signal, triggered a 10.0/10 anomaly score. Major financial publications covered the story two days later.
          </p>
        </div>

      </div>
      <SiteFooter />
    </>
  )
}
