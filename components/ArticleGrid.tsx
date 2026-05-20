interface Article {
  category: string
  title: string
  excerpt: string
  author: string
  time: string
  hasData?: boolean
  subscriber?: boolean
}

const INTELLIGENCE: Article[] = [
  {
    category: 'Payments',
    title: "PayPal's EU subsidiary restructure triggers €40m PDMR disclosure obligation",
    excerpt:
      'New entity structure means three senior executives must now file with ESMA directly — a compliance headache that signals broader regulatory intent.',
    author: 'Chris Cannon',
    time: '6h ago',
  },
  {
    category: 'FX & Treasury',
    title:
      'Wise, Currencycloud and Airwallex: who really controls the GBP-INR corridor?',
    excerpt:
      'A Loro analysis of FCA authorisation data and Companies House filings reveals a three-way concentration that regulators may not have modelled.',
    author: 'Loro Intelligence',
    time: '8h ago',
    subscriber: true,
  },
  {
    category: 'Open Banking',
    title:
      "Visa's Open Banking API adoption hits an inflection point in UK merchant acquiring",
    excerpt:
      'Data shared with Loro suggests A2A payment volumes via Tink and Token.io have doubled in two quarters among SME merchants.',
    author: 'Chris Cannon',
    time: 'Yesterday',
  },
  {
    category: 'Banking',
    title:
      'The quiet acquisition: how Revolut assembled its EU banking licence network',
    excerpt:
      'A deep-dive into nine months of regulatory filings, PDMR disclosures, and Companies House registrations across Lithuania, France and Ireland.',
    author: 'Loro Intelligence',
    time: '2 days ago',
    subscriber: true,
  },
  {
    category: 'Regulation',
    title:
      'PSD3 draft: the twelve provisions that will reshape payment institution authorisation',
    excerpt:
      "Loro's regulatory analysis team has identified the dozen clauses with the most material implications for UK fintechs seeking EU market access.",
    author: 'Chris Cannon',
    time: '2 days ago',
  },
  {
    category: 'ERP & Accounting',
    title: 'ERP market Q1 2026: Sage wins mid-market, Xero stalls, NetSuite churn rises',
    excerpt:
      "Loro's quarterly ERP Vendor Index — compiled from public filings, G2 review data, and Companies House accounts — shows a shifting landscape.",
    author: 'Loro Data',
    time: '3 days ago',
    hasData: true,
  },
]

const MARKETS: Article[] = [
  {
    category: 'FX Markets',
    title:
      'GBP weakness vs EUR: four structural factors the consensus is underweighting',
    excerpt:
      "Sterling's underperformance against the euro this quarter isn't about rates. Loro examines the payment flow data that tells a more complex story.",
    author: 'Loro Intelligence',
    time: 'Today',
  },
  {
    category: 'Settlement',
    title:
      'CHAPS vs Faster Payments: the latency gap is narrowing, and it matters for high-value fintech',
    excerpt:
      'New BoE benchmarking data — obtained under a Freedom of Information request — shows average CHAPS settlement at 4.1 minutes in Q1.',
    author: 'Chris Cannon',
    time: 'Yesterday',
  },
  {
    category: 'Crypto & On-chain',
    title:
      'On-chain signals: three wallet clusters moved £180m into stablecoins 48h before the announcement',
    excerpt:
      "Loro's on-chain monitoring flagged unusual USDC accumulation across identified institutional wallets. We followed the money.",
    author: 'Loro Data',
    time: '2 days ago',
    hasData: true,
  },
]

interface Props {
  variant?: 'intelligence' | 'markets'
}

export default function ArticleGrid({ variant = 'intelligence' }: Props) {
  const articles = variant === 'markets' ? MARKETS : INTELLIGENCE

  return (
    <div className="loro-art-grid">
      {articles.map((a, i) => (
        <article key={i} className="loro-art-item">
          <span className="loro-art-cat">{a.category}</span>
          <h3 className="loro-art-title">{a.title}</h3>
          <p className="loro-art-excerpt">{a.excerpt}</p>
          <div className="loro-art-meta">
            <span>{a.author}</span>
            <span className="loro-art-dot">·</span>
            <span>{a.time}</span>
            {a.hasData && (
              <>
                <span className="loro-art-dot">·</span>
                <span className="loro-art-badge">With data</span>
              </>
            )}
            {a.subscriber && (
              <>
                <span className="loro-art-dot">·</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    padding: '1px 7px',
                    border: '1px solid var(--border)',
                    borderRadius: 20,
                    color: 'var(--ink5)',
                  }}
                >
                  Sub
                </span>
              </>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}
