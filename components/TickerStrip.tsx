'use client'

import { useState, useEffect } from 'react'

interface Pair {
  label: string
  rate: number
  prev: number
}

function getPrevDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

function fmt(r: number): string {
  if (r >= 1000) return r.toFixed(1)
  if (r >= 100) return r.toFixed(2)
  if (r >= 10) return r.toFixed(3)
  return r.toFixed(4)
}

export default function TickerStrip() {
  const [pairs, setPairs] = useState<Pair[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const prevDate = getPrevDate()
        const [todayRes, prevRes] = await Promise.all([
          fetch('https://api.frankfurter.app/latest?from=GBP&to=EUR,USD,JPY,AUD,INR'),
          fetch(
            `https://api.frankfurter.app/${prevDate}?from=GBP&to=EUR,USD,JPY,AUD,INR`
          ),
        ])
        const today = await todayRes.json()
        const prev = await prevRes.json()

        const result: Pair[] = Object.entries(
          today.rates as Record<string, number>
        ).map(([to, rate]) => ({
          label: `GBP/${to}`,
          rate,
          prev: (prev.rates as Record<string, number>)[to] ?? rate,
        }))

        setPairs(result)
      } catch {
        // fail silently — ticker is non-critical
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div className="loro-ticker">
      <div className="loro-ticker-inner">
        {loading && (
          <span className="loro-ticker-loading">Loading rates…</span>
        )}
        {!loading && pairs.length === 0 && (
          <span className="loro-ticker-loading">Rate data unavailable</span>
        )}
        {pairs.map(({ label, rate, prev }) => {
          const pct = ((rate - prev) / prev) * 100
          const up = pct >= 0
          return (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="loro-ticker-pair">{label}</span>
              <span>{fmt(rate)}</span>
              <span className={up ? 'loro-ticker-up' : 'loro-ticker-dn'}>
                {up ? '↑' : '↓'}{Math.abs(pct).toFixed(2)}%
              </span>
              <span className="loro-ticker-div">│</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
