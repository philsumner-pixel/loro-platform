// Coverage meter — Chris's idea, made honest.
//
// A static "exclusive" badge is a claim about the moment of publication that
// quietly becomes a lie the day someone else covers the story. So this shows
// BOTH: where the story sits now, and how that has moved since we published.
//
// The trajectory is the interesting part, and it works in both directions:
//   nobody followed  → "Still the only substantive coverage" (a standing claim)
//   others followed  → "Loro reported this first. Four outlets have since
//                       followed." (a provenance claim, and a stronger one)
//
// Deliberately not framed as a boast. It reads as a statement of record, which
// is what makes it usable in a credible publication rather than a Daily Mail
// "they don't want you to know" device.

interface Props {
  status: string | null
  coverageNow: number | null
  coverageAtPublish: number | null
  wasFirst: boolean | null
  checkedAt: string | null
  publishedAt: string
  outletsWatched?: number | null
  lane?: string | null
}

const LEVELS: Record<string, { label: string; bars: number; tone: string }> = {
  exclusive:      { label: 'Only source',     bars: 1, tone: 'excl' },
  lightly_covered:{ label: 'Lightly covered', bars: 2, tone: 'light' },
  covered:        { label: 'Covered',         bars: 3, tone: 'mid' },
  widely_covered: { label: 'Widely covered',  bars: 5, tone: 'wide' },
}

function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400_000))
}

export default function CoverageMeter({
  status, coverageNow, coverageAtPublish, wasFirst, checkedAt, publishedAt,
  outletsWatched, lane,
}: Props) {
  if (!status) return null
  const level = LEVELS[status] ?? LEVELS.covered
  const now = coverageNow ?? 0
  const then = coverageAtPublish ?? 0
  const followed = Math.max(0, now - then)
  const days = checkedAt ? daysBetween(checkedAt, publishedAt) : 0

  // The sentence under the meter. Written per case rather than templated,
  // because each one is a materially different claim.
  let line: string
  const scope = outletsWatched
    ? `${outletsWatched} outlet${outletsWatched === 1 ? '' : 's'}`
    : 'the outlets'
  if (wasFirst && now === 0) {
    line = days >= 1
      ? `None of the ${scope} we monitor for this subject has covered it in the ${days === 1 ? 'day' : `${days} days`} since publication.`
      : `None of the ${scope} we monitor for this subject has covered it.`
  } else if (wasFirst && followed > 0) {
    line = `Loro reported this first. ${followed} other ${followed === 1 ? 'outlet has' : 'outlets have'} since covered it.`
  } else if (now === 0) {
    line = `No matching coverage among the ${scope} we monitor for this subject.`
  } else {
    line = `${now} other ${now === 1 ? 'outlet has' : 'outlets have'} covered this story.`
  }

  return (
    <aside className={`loro-cov loro-cov-${level.tone}`} aria-label="Story coverage">
      <div className="loro-cov-top">
        <span className="loro-cov-label">Coverage elsewhere</span>
        <span className="loro-cov-bars" role="img"
              aria-label={`${level.bars} of 5 — ${level.label}`}>
          {[1, 2, 3, 4, 5].map(i => (
            <span key={i} className={i <= level.bars ? 'on' : ''} />
          ))}
        </span>
        <span className="loro-cov-status">{level.label}</span>
      </div>
      <p className="loro-cov-line">{line}</p>
      <p className="loro-cov-meth">
        Measured continuously against the publications Loro monitors for this subject
        {lane ? '' : ''}, not the press as a whole. Coverage can change — this reflects the
        most recent check
        {checkedAt ? `, ${new Date(checkedAt).toLocaleDateString('en-GB',
          { day: 'numeric', month: 'short' })}` : ''}.
      </p>
    </aside>
  )
}
