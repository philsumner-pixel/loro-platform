import type { Metadata } from 'next'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'Subscribe — Loro Payments Intelligence',
  description: 'Get Loro Score alerts and intelligence briefings when payment companies show significant signal activity.',
}

export default function SubscribePage() {
  return (
    <>
      <Masthead />
      <div className="loro-wrap" style={{ padding: '64px 0 80px', maxWidth: 600 }}>

        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink5)', marginBottom: 12 }}>
            Intelligence alerts
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 'clamp(28px, 4vw, 38px)', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.15, marginBottom: 16 }}>
            Know before the market does.
          </h1>
          <p style={{ fontSize: 15, color: 'var(--ink4)', lineHeight: 1.75, marginBottom: 8 }}>
            The Loro Score monitors 11 payment companies across 6 regulatory sources. 
            When a score moves more than 10 points in 48 hours — the signal that historically precedes announcements — you get an alert before it becomes news.
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink5)', lineHeight: 1.65 }}>
            Free tier includes: Loro Score (daily). Paid tier adds: score breakdown, 30-day history, real-time alerts, API access.
          </p>
        </div>

        {/* What you get */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)', marginBottom: 40 }}>
          {[
            { label: 'Daily intelligence brief', sub: 'What moved overnight and why', free: true },
            { label: 'Loro Score alerts', sub: 'When a score spikes 10+ points', free: true },
            { label: 'Score breakdown', sub: '5 sub-scores + evidence data', free: false },
            { label: 'Real-time alerts', sub: 'Immediate notification on signal', free: false },
            { label: '30-day score history', sub: 'Trend and trajectory data', free: false },
            { label: 'API access', sub: 'Integrate into your workflow', free: false },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--bg)', padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: item.free ? '#2D7A2D' : '#E4E4E4', flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {item.free && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 11, color: 'var(--ink5)' }}>{item.sub} {!item.free && <span style={{ color: '#A16207', fontSize: 10 }}>Paid</span>}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Email form */}
        <div style={{ background: 'var(--paper2)', border: '1px solid var(--border)', padding: '28px 32px' }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>
            Start with the free tier
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink5)', marginBottom: 20 }}>
            Daily brief + score alerts. No credit card. Upgrade any time.
          </div>
          <form action="/api/subscribe" method="POST" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="email"
              name="email"
              placeholder="your@email.com"
              required
              style={{ padding: '12px 16px', border: '1px solid var(--border)', fontSize: 14, color: 'var(--ink)', background: 'var(--bg)', outline: 'none', fontFamily: "'Inter', sans-serif", width: '100%', boxSizing: 'border-box' }}
            />
            <input
              type="text"
              name="name"
              placeholder="Your name (optional)"
              style={{ padding: '12px 16px', border: '1px solid var(--border)', fontSize: 14, color: 'var(--ink)', background: 'var(--bg)', outline: 'none', fontFamily: "'Inter', sans-serif", width: '100%', boxSizing: 'border-box' }}
            />
            <input
              type="text"
              name="organisation"
              placeholder="Organisation (optional)"
              style={{ padding: '12px 16px', border: '1px solid var(--border)', fontSize: 14, color: 'var(--ink)', background: 'var(--bg)', outline: 'none', fontFamily: "'Inter', sans-serif", width: '100%', boxSizing: 'border-box' }}
            />
            <button type="submit"
              style={{ padding: '12px 28px', background: '#1A3A6B', color: '#fff', border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer', letterSpacing: '0.04em', fontFamily: "'Inter', sans-serif", alignSelf: 'flex-start' }}>
              Subscribe free →
            </button>
          </form>
          <div style={{ marginTop: 16, fontSize: 11, color: 'var(--ink5)' }}>
            No spam. Unsubscribe any time. Data not sold or shared.
          </div>
        </div>

      </div>
      <SiteFooter />
    </>
  )
}
