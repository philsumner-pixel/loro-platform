'use client'

import { useState, useEffect } from 'react'

interface FXWidget {
  rate: number | null
  pct: number | null
  dateLabel: string
}

function getPrevDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

export default function DataStrip() {
  const [fx, setFx] = useState<FXWidget>({ rate: null, pct: null, dateLabel: '' })

  useEffect(() => {
    async function loadFX() {
      try {
        const [todayRes, prevRes] = await Promise.all([
          fetch('https://api.frankfurter.app/latest?from=GBP&to=EUR'),
          fetch(`https://api.frankfurter.app/${getPrevDate()}?from=GBP&to=EUR`),
        ])
        const today = await todayRes.json()
        const prev = await prevRes.json()

        const rate = today.rates.EUR as number
        const prevRate = prev.rates.EUR as number
        const pct = ((rate - prevRate) / prevRate) * 100

        const d = new Date(today.date + 'T12:00:00Z')
        const dateLabel = d.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
        })

        setFx({ rate, pct, dateLabel })
      } catch {
        // fail silently
      }
    }
    loadFX()
  }, [])

  const rateStr = fx.rate ? fx.rate.toFixed(4) : null
  const pctStr =
    fx.pct !== null
      ? `${fx.pct >= 0 ? '↑ +' : '↓ '}${Math.abs(fx.pct).toFixed(2)}%`
      : null
  const pctClass =
    fx.pct !== null
      ? fx.pct >= 0
        ? 'loro-dw-chg loro-dw-up'
        : 'loro-dw-chg loro-dw-dn'
      : 'loro-dw-chg loro-dw-flat'

  return (
    <div className="loro-data-strip">
      <div className="loro-data-lbl">Live data</div>

      <div className="loro-data-widgets">

        {/* FX Pulse — live from ECB */}
        <div className="loro-dw">
          <div className="loro-dw-eye">FX Pulse</div>
          <div className="loro-dw-sub">GBP / EUR</div>
          <div className="loro-dw-row">
            {rateStr ? (
              <>
                <span className="loro-dw-val">{rateStr}</span>
                <span className={pctClass}>{pctStr}</span>
              </>
            ) : (
              <span
                className="loro-sk"
                style={{ width: 80, height: 22 }}
              />
            )}
          </div>
          <div className="loro-dw-note">
            {fx.dateLabel
              ? `ECB mid-market · ${fx.dateLabel}`
              : 'ECB mid-market · Loading…'}
          </div>
        </div>

        {/* Latest Funding — placeholder until pipeline connected */}
        <div className="loro-dw">
          <div className="loro-dw-eye">Latest Funding</div>
          <div className="loro-dw-sub">Modulr · Series C</div>
          <div className="loro-dw-row">
            <span className="loro-dw-val" style={{ fontSize: 20 }}>
              £95m
            </span>
            <span
              className="loro-dw-chg"
              style={{ color: 'var(--ink4)', fontSize: 12 }}
            >
              raised
            </span>
          </div>
          <div className="loro-dw-note">4 hours ago · Valuation £600m</div>
        </div>

        {/* Settlement Index — placeholder until index built */}
        <div className="loro-dw">
          <div className="loro-dw-eye">Settlement Index</div>
          <div className="loro-dw-sub">SEPA Instant</div>
          <div className="loro-dw-row">
            <span className="loro-dw-val" style={{ fontSize: 20 }}>
              8.2s
            </span>
            <span className="loro-dw-chg loro-dw-up">↓ −0.3s</span>
          </div>
          <div className="loro-dw-note">EU average · Q2 2026 benchmark</div>
        </div>

        {/* Ownership Intel — placeholder until PDMR pipeline connected */}
        <div className="loro-dw">
          <div className="loro-dw-eye">Ownership Intel</div>
          <div className="loro-dw-sub">CFO · Barclays PLC</div>
          <div className="loro-dw-row">
            <span className="loro-dw-val" style={{ fontSize: 20 }}>
              £2.1m
            </span>
            <span className="loro-dw-chg loro-dw-dn">sold</span>
          </div>
          <div className="loro-dw-note">Form PDMR · FCA · 6h ago</div>
        </div>

      </div>
    </div>
  )
}
