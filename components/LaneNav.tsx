// Public-site lane navigation. Mirrors the newsroom lane filter — one
// taxonomy, two views. Kept as a static list so it renders without a DB call
// on every page; the canonical definitions live in loro_content_lanes.

const LANES = [
  { slug: 'ownership-control',         label: 'Ownership & Control' },
  { slug: 'regulation-enforcement',    label: 'Regulation & Enforcement' },
  { slug: 'money-markets',             label: 'Money & Markets' },
  { slug: 'policy-politics',           label: 'Policy & Politics' },
  { slug: 'energy-sustainability',     label: 'Energy & Sustainability' },
  { slug: 'technology-infrastructure', label: 'Technology & Infrastructure' },
]

export default function LaneNav({ active }: { active?: string }) {
  return (
    <nav className="loro-subnav">
      <div className="loro-subnav-inner">
        <a href="/" className={active ? undefined : 'loro-active'}>All</a>
        {LANES.map(l => (
          <a
            key={l.slug}
            href={`/lane/${l.slug}`}
            className={active === l.slug ? 'loro-active' : undefined}
            style={{ letterSpacing: '0.01em' }}
          >
            {l.label}
          </a>
        ))}
        <a
          href="/intelligence"
          style={{ marginLeft: 'auto', color: 'var(--ink4)', letterSpacing: '0.01em' }}
        >
          Intelligence sources &rarr;
        </a>
      </div>
    </nav>
  )
}
