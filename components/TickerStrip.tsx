'use client'

import { useState, useEffect } from 'react'

// Rate strip, served from Loro's own ECB ingest.
//
// This previously called api.frankfurter.app directly from the browser and was
// failing, so every page carried "Rate data unavailable" at the very top. Now
// it reads /api/ticker, which is backed by the ECB Data Portal ingest — one
// fewer third-party dependency on the most visible element of the site, and
// numbers we can actually attribute.
//
// If the fetch fails the strip renders NOTHING rather than an error message:
// an empty bar is unremarkable, a permanent error notice is not.

interface Item {
  label: string
  value: string
  unit: string
  change: number
  direction: 'up' | 'down' | 'flat'
  period: string | null
}

export default function TickerStrip() {
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/ticker')
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d.items)) setItems(d.items) })
      .catch(() => { /* strip is non-critical — stay silent */ })
    return () => { cancelled = true }
  }, [])

  // Render nothing until there is something worth showing.
  if (!items.length) return <div className="loro-ticker" aria-hidden="true" />

  return (
    <div className="loro-ticker">
      <div className="loro-ticker-inner">
        {items.map(it => (
          <span key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="loro-ticker-pair">{it.label}</span>
            <span>{it.value}{it.unit}</span>
            {it.direction !== 'flat' && (
              <span className={it.direction === 'up' ? 'loro-ticker-up' : 'loro-ticker-dn'}>
                {it.direction === 'up' ? '↑' : '↓'}
                {Math.abs(it.change)}
              </span>
            )}
            <span className="loro-ticker-div">│</span>
          </span>
        ))}
        <span className="loro-ticker-src">ECB</span>
      </div>
    </div>
  )
}
