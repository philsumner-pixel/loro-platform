'use client'

interface AdSlotProps {
  id: string
  type: 'inread-home' | 'inread-article'
}

/**
 * Teads inRead integration:
 *
 * 1. Add Teads global script to app/layout.tsx <head>:
 *    <Script src="//a.teads.tv/media/format/v3/teads-format.min.js" strategy="lazyOnload" />
 *
 * 2. Get slot IDs from Teads dashboard and set as the `id` prop
 *    e.g. <AdSlot id="teads-12345" type="inread-home" />
 *
 * 3. Teads script auto-discovers the div by ID and injects the player.
 *    It handles its own height — this component just provides the container.
 *
 * For other premium networks (e.g. Magnite, Index Exchange):
 * Same principle — just change the script src and slot ID format.
 *
 * The slot collapses to nothing when no ad loads (min-height: 0, no border).
 */
export default function AdSlot({ id, type }: AdSlotProps) {
  return (
    <div
      className="loro-ad-slot"
      data-ad-type={type}
      aria-label="Advertisement"
    >
      <p className="loro-ad-label">Advertisement</p>
      <div id={id} className="loro-ad-inner" />
    </div>
  )
}
