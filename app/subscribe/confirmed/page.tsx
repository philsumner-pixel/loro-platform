import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'

export default function ConfirmedPage({
  searchParams,
}: {
  searchParams: { track?: string }
}) {
  const isB2B = searchParams.track === 'intelligence'

  return (
    <>
      <Masthead />
      <div className="loro-wrap" style={{ padding: '80px 0', maxWidth: 540 }}>
        <div style={{ fontSize: 32, marginBottom: 20, color: '#2D7A2D', fontWeight: 700 }}>OK</div>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 700, color: 'var(--ink)', marginBottom: 16, lineHeight: 1.2 }}>
          {isB2B ? 'Request received.' : 'You are subscribed.'}
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink4)', lineHeight: 1.75, marginBottom: 32 }}>
          {isB2B
            ? 'We will review your request and be in touch within 48 hours. Early access to Loro Intelligence is limited. We are prioritising institutional investors, payments executives and M&A professionals in the first cohort.'
            : 'Loro Weekly lands every Friday morning. Plain English, what moved in payments, what it means.'}
        </p>

        {isB2B ? (
          <div style={{ background: 'var(--paper2)', border: '1px solid var(--border)', padding: '20px 24px', marginBottom: 32 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>
              While you wait
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink4)', lineHeight: 1.7 }}>
              The PayPal Holdings entity page is live with today&apos;s intelligence data.{' '}
              <a href="/companies/paypal-holdings" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                See what the engine flagged
              </a>
            </div>
          </div>
        ) : (
          <div style={{ background: 'var(--paper2)', border: '1px solid var(--border)', padding: '20px 24px', marginBottom: 32 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>
              Need real-time intelligence?
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink4)', lineHeight: 1.7 }}>
              Loro Intelligence gives institutional investors and payments professionals PDMR alerts and Loro Score notifications before the weekly digest.{' '}
              <a href="/subscribe/intelligence" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                Request access
              </a>
            </div>
          </div>
        )}

        <a href="/" style={{ padding: '10px 22px', background: '#1A3A6B', color: '#fff', fontSize: 13, fontWeight: 500, textDecoration: 'none', letterSpacing: '0.04em', display: 'inline-block' }}>
          Read latest intelligence
        </a>
      </div>
      <SiteFooter />
    </>
  )
}
