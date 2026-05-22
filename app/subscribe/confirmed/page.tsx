import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'

export default function ConfirmedPage() {
  return (
    <>
      <Masthead />
      <div className="loro-wrap" style={{ padding: '80px 0', maxWidth: 560, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>✓</div>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 700, color: 'var(--ink)', marginBottom: 16 }}>
          You're subscribed.
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink4)', lineHeight: 1.75, marginBottom: 32 }}>
          Daily intelligence briefs and Loro Score alerts will land in your inbox. 
          When a monitored payment company shows an anomalous signal, you'll know before it's news.
        </p>
        <a href="/" style={{ padding: '10px 24px', background: '#1A3A6B', color: '#fff', fontSize: 13, fontWeight: 500, textDecoration: 'none', letterSpacing: '0.04em' }}>
          Read the latest intelligence →
        </a>
      </div>
      <SiteFooter />
    </>
  )
}
