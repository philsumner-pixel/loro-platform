import type { Metadata } from 'next'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = { title: 'Confirmed - Loro Payment Intelligence' }

export default async function ConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ track?: string }>
}) {
  const params = await searchParams
  const isB2B = params.track === 'intelligence'

  return (
    <>
      <Masthead />
      <div className="loro-wrap" style={{ padding: '80px 0 96px', maxWidth: 560 }}>

        <div style={{ width: 40, height: 40, background: isB2B ? 'var(--blue)' : 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 28 }}>
          <span style={{ color: '#fff', fontSize: 20 }}>&#10003;</span>
        </div>

        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: isB2B ? 'var(--blue)' : 'var(--green)', marginBottom: 12 }}>
          {isB2B ? 'Request received' : 'Subscribed'}
        </div>

        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 'clamp(24px, 3.5vw, 30px)', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2, marginBottom: 18 }}>
          {isB2B ? 'We will be in touch within 48 hours.' : 'Welcome to Loro Weekly.'}
        </h1>

        <p style={{ fontSize: 15, color: 'var(--ink4)', lineHeight: 1.8, marginBottom: 40 }}>
          {isB2B
            ? 'Early access to Loro Intelligence is limited to the first cohort. We are prioritising institutional investors, payments executives and M\u0026A professionals. We will review your request and confirm your access shortly.'
            : 'Your first edition arrives this Friday morning. Plain English, what moved in payments, what it means. No noise.'}
        </p>

        <div style={{ height: 1, background: 'var(--border)', marginBottom: 32 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink5)', marginBottom: 4 }}>
            While you wait
          </div>

          {isB2B ? (
            <>
              <a href="/companies/paypal-holdings" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'var(--paper2)', border: '1px solid var(--border)', textDecoration: 'none' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>PayPal Holdings — live entity page</div>
                  <div style={{ fontSize: 12, color: 'var(--ink4)' }}>Score breakdown, sub-scores and today&apos;s signal data</div>
                </div>
                <span style={{ color: 'var(--blue)', fontSize: 16, flexShrink: 0 }}>&#8594;</span>
              </a>
              <a href="/dashboard" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'var(--paper2)', border: '1px solid var(--border)', textDecoration: 'none' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>Entity signal landscape</div>
                  <div style={{ fontSize: 12, color: 'var(--ink4)' }}>All monitored entities scored and mapped</div>
                </div>
                <span style={{ color: 'var(--blue)', fontSize: 16, flexShrink: 0 }}>&#8594;</span>
              </a>
            </>
          ) : (
            <>
              <a href="/" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'var(--paper2)', border: '1px solid var(--border)', textDecoration: 'none' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>Latest payments intelligence</div>
                  <div style={{ fontSize: 12, color: 'var(--ink4)' }}>This week&apos;s signal activity on the homepage</div>
                </div>
                <span style={{ color: 'var(--blue)', fontSize: 16, flexShrink: 0 }}>&#8594;</span>
              </a>
              <a href="/subscribe/intelligence" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'var(--paper2)', border: '1px solid var(--border)', textDecoration: 'none' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>Need real-time alerts?</div>
                  <div style={{ fontSize: 12, color: 'var(--ink4)' }}>Loro Intelligence — request early access</div>
                </div>
                <span style={{ color: 'var(--blue)', fontSize: 16, flexShrink: 0 }}>&#8594;</span>
              </a>
            </>
          )}
        </div>
      </div>
      <SiteFooter />
    </>
  )
}
