import type { Metadata } from 'next'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'Loro Weekly - Free Newsletter',
  description: 'Weekly payments intelligence for retail investors and fintech enthusiasts. Free.',
}

export default function WeeklySignupPage() {
  return (
    <>
      <Masthead />
      <div className="loro-wrap" style={{ padding: '56px 0 80px', maxWidth: 560 }}>

        <a href="/subscribe" style={{ fontSize: 12, color: 'var(--ink5)', textDecoration: 'none', display: 'block', marginBottom: 32 }}>
          Back to all plans
        </a>

        <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink5)', marginBottom: 10 }}>
          Free / Weekly newsletter
        </div>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 'clamp(26px, 4vw, 34px)', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2, marginBottom: 14 }}>
          Loro Weekly
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink4)', lineHeight: 1.75, marginBottom: 36 }}>
          The week in payments, plain English. What moved, who filed, what it means. Every Friday morning.
        </p>

        <div style={{ background: 'var(--paper2)', border: '1px solid var(--border)', padding: '28px 32px', marginBottom: 32 }}>
          <form action="/api/subscribe" method="POST" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <input type="hidden" name="audience_type" value="retail" />
            <input type="hidden" name="tier" value="free" />

            <div>
              <label style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink5)', display: 'block', marginBottom: 6 }}>
                Email address *
              </label>
              <input type="email" name="email" required placeholder="your@email.com"
                style={{ width: '100%', padding: '11px 14px', border: '1px solid var(--border)', fontSize: 14, color: 'var(--ink)', background: 'var(--bg)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink5)', display: 'block', marginBottom: 6 }}>
                First name
              </label>
              <input type="text" name="name" placeholder="Optional"
                style={{ width: '100%', padding: '11px 14px', border: '1px solid var(--border)', fontSize: 14, color: 'var(--ink)', background: 'var(--bg)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink5)', display: 'block', marginBottom: 6 }}>
                What brought you here?
              </label>
              <select name="interest_note"
                style={{ width: '100%', padding: '11px 14px', border: '1px solid var(--border)', fontSize: 14, color: 'var(--ink)', background: 'var(--bg)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}>
                <option value="">Select one (optional)</option>
                <option value="retail_investor">I invest in fintech / payments stocks</option>
                <option value="enthusiast">I follow the payments industry</option>
                <option value="work_adjacent">I work in a related industry</option>
                <option value="other">Other</option>
              </select>
            </div>

            <button type="submit"
              style={{ padding: '12px 28px', background: 'var(--ink)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer', letterSpacing: '0.04em', fontFamily: 'inherit', alignSelf: 'flex-start' }}>
              Subscribe free
            </button>

            <div style={{ fontSize: 11, color: 'var(--ink5)' }}>
              Free. No credit card. Unsubscribe any time. One email per week.
            </div>
          </form>
        </div>

        <div style={{ fontSize: 13, color: 'var(--ink5)', lineHeight: 1.7 }}>
          Looking for real-time intelligence and PDMR alerts?{' '}
          <a href="/subscribe/intelligence" style={{ color: 'var(--ink)', fontWeight: 500 }}>
            Loro Intelligence
          </a>
        </div>

      </div>
      <SiteFooter />
    </>
  )
}
