import type { Metadata } from 'next'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'Subscribe — Loro Payments Intelligence',
  description: 'Two tiers: Loro Weekly for payments enthusiasts, Loro Intelligence for institutional investors and B2B professionals.',
}

export default function SubscribePage({
  searchParams,
}: {
  searchParams: { track?: string; confirmed?: string }
}) {
  const track = searchParams.track  // 'weekly' | 'intelligence'

  return (
    <>
      <Masthead />
      <div className="loro-wrap" style={{ padding: '56px 0 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 48, maxWidth: 560 }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink5)', marginBottom: 12 }}>
            Who is Loro for?
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 'clamp(26px, 4vw, 36px)', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2, marginBottom: 14 }}>
            Two products.<br />Same intelligence layer.
          </h1>
          <p style={{ fontSize: 15, color: 'var(--ink4)', lineHeight: 1.75 }}>
            Loro publishes independent payments intelligence. The story is the same — how you receive it depends on what you do with it.
          </p>
        </div>

        {/* Two track cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)', marginBottom: 48 }}>

          {/* Track 1: Loro Weekly */}
          <div style={{ background: 'var(--bg)', padding: '32px 32px 28px', borderTop: '3px solid var(--ink4)' }}>
            <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink5)', marginBottom: 10 }}>
              Free · Weekly
            </div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 700, color: 'var(--ink)', marginBottom: 8, lineHeight: 1.2 }}>
              Loro Weekly
            </h2>
            <p style={{ fontSize: 13, color: 'var(--ink4)', lineHeight: 1.7, marginBottom: 24 }}>
              For retail investors, fintech enthusiasts and anyone who wants to understand what's happening in payments — without needing to read a regulatory filing first.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
              {[
                'Weekly roundup of what moved in payments',
                'Plain-English breakdown of key signals',
                'Company watchlist — who's active, who's quiet',
                'Loro Score weekly snapshot (top 5 movers)',
              ].map(item => (
                <div key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 14, height: 14, border: '1px solid var(--ink4)', borderRadius: '50%', flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink4)' }} />
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--ink4)', lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12, color: 'var(--ink5)', marginBottom: 16 }}>
              Good for: retail investors · payments enthusiasts · fintech followers
            </div>

            <a href="/subscribe/weekly"
              style={{ display: 'inline-block', padding: '10px 22px', background: 'var(--ink)', color: '#fff', fontSize: 12, fontWeight: 500, textDecoration: 'none', letterSpacing: '0.04em' }}>
              Subscribe free →
            </a>
          </div>

          {/* Track 2: Loro Intelligence */}
          <div style={{ background: '#0A0A0A', padding: '32px 32px 28px', borderTop: '3px solid #1A3A6B' }}>
            <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#3A5A8A', marginBottom: 10 }}>
              Paid · Real-time
            </div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 700, color: '#F5F5F4', marginBottom: 8, lineHeight: 1.2 }}>
              Loro Intelligence
            </h2>
            <p style={{ fontSize: 13, color: '#8A8A8A', lineHeight: 1.7, marginBottom: 24 }}>
              For institutional investors, payments professionals, M&amp;A teams and anyone who needs to know before the market does. The signal that precedes the story.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
              {[
                'Real-time Loro Score alerts (10+ point moves)',
                'PDMR and insider trade signal detection',
                'Cross-jurisdictional regulatory pattern intelligence',
                'Entity pages with full score breakdown + history',
                'Breaking story access before newsletter distribution',
                'API access for workflow integration',
              ].map(item => (
                <div key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 14, height: 14, border: '1px solid #1A3A6B', borderRadius: '50%', flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#1A3A6B' }} />
                  </div>
                  <span style={{ fontSize: 13, color: '#8A8A8A', lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12, color: '#3A3A3A', marginBottom: 16 }}>
              Good for: institutional investors · payments execs · M&amp;A teams · regulatory professionals
            </div>

            <a href="/subscribe/intelligence"
              style={{ display: 'inline-block', padding: '10px 22px', background: '#1A3A6B', color: '#fff', fontSize: 12, fontWeight: 500, textDecoration: 'none', letterSpacing: '0.04em' }}>
              Request access →
            </a>
          </div>
        </div>

        {/* The PayPal proof case */}
        <div style={{ padding: '24px 28px', background: 'var(--paper2)', borderLeft: '3px solid #1A3A6B', maxWidth: 680 }}>
          <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#1A3A6B', marginBottom: 8 }}>
            What intelligence looks like in practice
          </div>
          <p style={{ fontSize: 14, color: 'var(--ink3)', lineHeight: 1.75, margin: 0 }}>
            On 21 May 2026, Loro's intelligence engine detected 13 PayPal insider trade filings in a 72-hour window — a pattern consistent with pre-announcement activity. Anomaly score: 10.0/10. No UK or EU publication had reported the cluster. Loro Intelligence subscribers were alerted. Loro Weekly covered it the following week.
          </p>
        </div>

      </div>
      <SiteFooter />
    </>
  )
}
