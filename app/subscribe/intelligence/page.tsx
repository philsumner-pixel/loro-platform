import type { Metadata } from 'next'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'Loro Intelligence - B2B Access',
  description: 'Real-time payments intelligence for institutional investors, payments professionals and M&A teams.',
}

const FEATURES = [
  {
    title: 'Loro Score alerts',
    desc: 'Notified immediately when a monitored entity moves 10+ points. The PayPal cluster triggered at 10.0/10, 48 hours before any publication covered it.',
  },
  {
    title: 'PDMR and insider intelligence',
    desc: 'Director transactions, PSC changes, share allotments. Parsed to extract person, role, transaction type and value. The signal institutional investors track.',
  },
  {
    title: 'Cross-jurisdictional patterns',
    desc: 'UK FCA + EU + US SEC signals for the same entity within 72 hours. The combination that scores maximum anomaly and precedes material announcements.',
  },
  {
    title: 'Entity pages and score history',
    desc: 'Full sub-score breakdown, 30-day trend, evidence data. Not just the number, the story behind it.',
  },
  {
    title: 'Breaking story access',
    desc: 'Loro Intelligence subscribers read stories before the weekly newsletter. The editorial loop runs newsroom to Intelligence to Weekly.',
  },
]

export default function IntelligenceSignupPage() {
  return (
    <>
      <Masthead />
      <div className="loro-wrap" style={{ padding: '56px 0 80px', maxWidth: 560 }}>

        <a href="/subscribe" style={{ fontSize: 12, color: 'var(--ink5)', textDecoration: 'none', display: 'block', marginBottom: 32 }}>
          Back to all plans
        </a>

        <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#3A5A8A', marginBottom: 10 }}>
          Paid / Real-time intelligence
        </div>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 'clamp(26px, 4vw, 34px)', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2, marginBottom: 14 }}>
          Loro Intelligence
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink4)', lineHeight: 1.75, marginBottom: 36 }}>
          The signal before the story. Real-time regulatory intelligence for people who need to know what is happening at a payments company before it is in the news.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--border)', marginBottom: 32 }}>
          {FEATURES.map(item => (
            <div key={item.title} style={{ background: 'var(--bg)', padding: '16px 20px', borderLeft: '3px solid #1A3A6B' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginBottom: 4 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: 'var(--ink4)', lineHeight: 1.6 }}>{item.desc}</div>
            </div>
          ))}
        </div>

        <div style={{ background: '#0A0A0A', padding: '28px 32px', marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#F5F5F4', marginBottom: 4 }}>
            Request access
          </div>
          <div style={{ fontSize: 12, color: '#5A5A5A', marginBottom: 20 }}>
            Loro Intelligence is in early access. We review each application. Pricing on request.
          </div>

          <form action="/api/subscribe" method="POST" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <input type="hidden" name="audience_type" value="b2b" />
            <input type="hidden" name="tier" value="paid" />

            {[
              { label: 'Work email *', name: 'email', type: 'email', placeholder: 'you@firm.com', required: true },
              { label: 'Name *', name: 'name', type: 'text', placeholder: 'Your name', required: true },
              { label: 'Organisation *', name: 'organisation', type: 'text', placeholder: 'Fund, firm or company', required: true },
            ].map(field => (
              <div key={field.name}>
                <label style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#3A3A3A', display: 'block', marginBottom: 6 }}>
                  {field.label}
                </label>
                <input type={field.type} name={field.name} required={field.required} placeholder={field.placeholder}
                  style={{ width: '100%', padding: '11px 14px', border: '1px solid #2A2A2A', fontSize: 14, color: '#F5F5F4', background: '#141414', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
            ))}

            <div>
              <label style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#3A3A3A', display: 'block', marginBottom: 6 }}>
                Role
              </label>
              <select name="role"
                style={{ width: '100%', padding: '11px 14px', border: '1px solid #2A2A2A', fontSize: 14, color: '#F5F5F4', background: '#141414', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}>
                <option value="">Select one</option>
                <option value="institutional_investor">Institutional investor</option>
                <option value="hedge_fund">Hedge fund / long-short</option>
                <option value="vc_pe">VC / PE</option>
                <option value="payments_exec">Payments company executive</option>
                <option value="fintech_exec">Fintech executive</option>
                <option value="ma_advisory">M&amp;A / corporate advisory</option>
                <option value="regulatory">Regulatory / compliance</option>
                <option value="analyst">Equity analyst</option>
                <option value="journalist">Journalist / media</option>
                <option value="other">Other</option>
              </select>
            </div>

            <button type="submit"
              style={{ padding: '12px 28px', background: '#1A3A6B', color: '#fff', border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer', letterSpacing: '0.04em', fontFamily: 'inherit', alignSelf: 'flex-start' }}>
              Request access
            </button>

            <div style={{ fontSize: 11, color: '#3A3A3A' }}>
              We will respond within 48 hours. Early access pricing available.
            </div>
          </form>
        </div>

        <div style={{ fontSize: 13, color: 'var(--ink5)', lineHeight: 1.7 }}>
          Just want the weekly digest?{' '}
          <a href="/subscribe/weekly" style={{ color: 'var(--ink)', fontWeight: 500 }}>
            Loro Weekly is free
          </a>
        </div>

      </div>
      <SiteFooter />
    </>
  )
}
