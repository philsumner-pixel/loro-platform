'use client'

import { useEffect, useRef, useState } from 'react'

export interface EntityScore {
  entity_id: string
  entity_name: string
  entity_slug: string
  jurisdiction: string
  loro_score: number
  score_delta: number | null
  regulatory_score: number | null
  sentiment_score: number | null
  news_score: number | null
  ownership_score: number | null
  market_score: number | null
  regulatory_events_7d: number | null
  avg_anomaly_score_7d: number | null
  pdmr_events_7d: number | null
  insider_direction: string | null
  alert_triggered: boolean | null
}

interface Props { entities: EntityScore[] }

const BARS = [
  { l: 'Regulatory', k: 'regulatory_score' as const, c: '#A32D2D' },
  { l: 'Sentiment',  k: 'sentiment_score'  as const, c: '#185FA5' },
  { l: 'News',       k: 'news_score'       as const, c: '#0F6E56' },
  { l: 'Ownership',  k: 'ownership_score'  as const, c: '#A16207' },
  { l: 'Market',     k: 'market_score'     as const, c: '#6A7A86' },
]

// Strip legal suffixes for cleaner display
function cleanName(raw: string): string {
  return raw
    .replace(/\s+Holdings$/i, ' Holdings')
    .replace(/\s+(Group\s+)?Ltd\.?$/i, '')
    .replace(/\s+Limited$/i, '')
    .replace(/\s+Inc\.?$/i, '')
    .replace(/\s+NV$/i, '')
    .replace(/\s+Payments\s+Ltd$/i, '')
    .replace(/\s+Finance\s+Ltd$/i, ' Finance')
    .replace(/\s+Bank\s+Ltd$/i, ' Bank')
    .trim()
}

// Approximate label width in pixels
function labelW(name: string): number {
  return Math.max(name.length * 5.6 + 4, 24)
}

export default function EntityLandscape({ entities }: Props) {
  const svgRef   = useRef<SVGSVGElement>(null)
  const [selected, setSelected]   = useState<EntityScore | null>(null)
  const [activeJur, setActiveJur] = useState('all')

  const highlighted = entities.reduce((best, e) =>
    e.loro_score > (best?.loro_score ?? 0) ? e : best
  , entities[0])

  useEffect(() => {
    if (!svgRef.current || !entities.length) return

    import('d3').then(d3 => {
      const svg = svgRef.current!
      const W   = svg.clientWidth || 460
      const H   = 360
      const ml = 52, mt = 22, mr = 14, mb = 44
      const pw  = W - ml - mr
      const ph  = H - mt - mb

      // -- X scale: news_score (0-100) ----------------------------------
      // regulatory_score is 0 for all entities except the one with live
      // filings — useless for horizontal spread. news_score has real
      // variance today (0-75) and will continue to differentiate entities
      // as more articles flow in. Simple linear scale, no skew detection.
      const isSkewed = false  // kept for tickFormat compat below
      const xMax = 100
      const xSc  = d3.scaleLinear().domain([0, xMax]).range([0, pw])

      // -- Y scale: linear loro_score -----------------------------------
      // Simple linear scale. Floor set to 5 below min score so the
      // bottom entity has breathing room above the x-axis.
      const yMin   = Math.max(0, Math.floor(Math.min(...entities.map(e => e.loro_score)) / 5) * 5 - 5)
      const yMax2  = Math.ceil(Math.max(...entities.map(e => e.loro_score)) / 5) * 5 + 5
      const ySc    = d3.scaleLinear().domain([yMin, yMax2]).range([ph, 0])

      // yForId: convenience wrapper used in dotPos and grid
      function yForId(entityId: string): number {
        const e = entities.find(en => en.entity_id === entityId)
        return ySc(e?.loro_score ?? yMin)
      }

      const maxEv = Math.max(...entities.map(e => e.regulatory_events_7d ?? 0), 1)
      const rSc   = d3.scaleSqrt().domain([0, maxEv]).range([4, 13])

      // -- Colours ---------------------------------------------------
      const isDark  = matchMedia('(prefers-color-scheme:dark)').matches
      const LAPIS   = isDark ? '#5A9EC4' : '#1A3A6B'
      const RED     = isDark ? '#F09595' : '#A32D2D'
      const cs      = getComputedStyle(document.documentElement)
      const COL_TER = cs.getPropertyValue('--color-text-tertiary').trim()  || '#888'
      const COL_SEC = cs.getPropertyValue('--color-text-secondary').trim() || '#555'
      const COL_BDR = cs.getPropertyValue('--color-border-tertiary').trim()|| '#eee'

      function dotColor(e: EntityScore) { return e === highlighted ? RED : LAPIS }

      // -- Dot positions (fixed) --------------------------------------
      const dotPos = entities.map(e => ({
        x:  xSc(e.news_score ?? 0),
        y:  yForId(e.entity_id),
        fx: xSc(e.news_score ?? 0),
        fy: yForId(e.entity_id),
      }))

      // -- Force-directed label placement ----------------------------
      const labelH = 22

      interface LabelNode {
        x: number; y: number; vx: number; vy: number; i: number
        fx?: number | null; fy?: number | null
      }

      const labelNodes: LabelNode[] = entities.map((e, i) => {
        const dx  = dotPos[i].x
        const dy  = dotPos[i].y
        const isRight  = dx > pw * 0.65
        const isTop    = dy < ph * 0.40
        const isLeft   = dx < pw * 0.20
        let ox = 16, oy = 0
        if (e === highlighted)      { ox = -82; oy = -22 }
        else if (isRight && isTop)  { ox = -68; oy = -18 }
        else if (isRight)           { ox = -68; oy = 0   }
        else if (isLeft && isTop)   { ox = 14;  oy = -20 }
        else if (isLeft)            { ox = 14;  oy = 0   }
        else if (isTop)             { ox = 14;  oy = -20 }
        else                        { ox = 14;  oy = 0   }
        return { x: dx + ox, y: dy + oy, vx: 0, vy: 0, i }
      })

      const links = entities.map((e, i) => ({
        source:   labelNodes[i],
        target:   dotPos[i],
        strength: e === highlighted ? 0.28 : 0.52,
        distance: e === highlighted ? 55   : 20,
      }))

      // Rectangular collision force
      function forceRectCollide() {
        let ns: LabelNode[]
        function force(alpha: number) {
          for (let i = 0; i < ns.length; i++) {
            const ni = ns[i]
            const cn = cleanName(entities[ni.i].entity_name)
            const wiH = labelW(cn) / 2 + 4
            const hiH = labelH / 2 + 4
            for (let j = i + 1; j < ns.length; j++) {
              const nj  = ns[j]
              const cnj = cleanName(entities[nj.i].entity_name)
              const wjH = labelW(cnj) / 2 + 4
              const hjH = labelH / 2 + 4
              const dx  = nj.x - ni.x
              const dy  = nj.y - ni.y
              const ox  = wiH + wjH - Math.abs(dx)
              const oy  = hiH + hjH - Math.abs(dy)
              if (ox > 0 && oy > 0) {
                const push = Math.min(ox, oy) * 0.65 * alpha
                if (ox < oy) {
                  const d2 = dx > 0 ? push : -push
                  ni.x -= d2 * 0.5; nj.x += d2 * 0.5
                } else {
                  const d2 = dy > 0 ? push : -push
                  ni.y -= d2 * 0.5; nj.y += d2 * 0.5
                }
              }
            }
            const maxW = labelW(cn) / 2 + 2
            ni.x = Math.max(maxW, Math.min(pw - maxW, ni.x))
            ni.y = Math.max(labelH / 2 + 2, Math.min(ph - labelH / 2 - 2, ni.y))
          }
        }
        force.initialize = (n: LabelNode[]) => { ns = n }
        return force
      }

      const sim = d3.forceSimulation<LabelNode>(labelNodes)
        .force('rect', forceRectCollide())
        .force('link', d3.forceLink(links)
          .strength(d => (d as { strength: number }).strength)
          .distance(d => (d as { distance: number }).distance))
        .force('dotX', d3.forceX<LabelNode>().x(d => dotPos[d.i].x).strength(0.03))
        .force('dotY', d3.forceY<LabelNode>().y(d => dotPos[d.i].y).strength(0.03))
        .stop()

      for (let t = 0; t < 480; t++) sim.tick()

      // -- Render ----------------------------------------------------
      const root = d3.select(svg)
      root.selectAll('*').remove()
      root.attr('viewBox', `0 0 ${W} ${H}`)

      const g = root.append('g').attr('transform', `translate(${ml},${mt})`)

      // Grid lines + axes
      g.selectAll('.gx').data(ySc.ticks(5)).join('line')
        .attr('x1', 0).attr('x2', pw)
        .attr('y1', d => ySc(d)).attr('y2', d => ySc(d))
        .attr('stroke', COL_BDR).attr('stroke-width', 0.5)

      // X axis
      g.append('g').attr('transform', `translate(0,${ph})`)
        .call(d3.axisBottom(xSc).ticks(5).tickSize(3).tickPadding(5)
          .tickFormat(n => String(Math.round(n as number))))
        .call(a => {
          a.select('.domain').attr('stroke', COL_BDR).attr('stroke-width', 0.5)
          a.selectAll('line').attr('stroke', COL_BDR)
          a.selectAll('text').attr('fill', COL_TER).attr('font-size', 9.5)
            .style('font-family', 'var(--font-mono)')
        })

      // Y axis
      g.append('g').call(d3.axisLeft(ySc).ticks(5).tickSize(3).tickPadding(5))
        .call(a => {
          a.select('.domain').attr('stroke', COL_BDR).attr('stroke-width', 0.5)
          a.selectAll('line').attr('stroke', COL_BDR)
          a.selectAll('text').attr('fill', COL_TER).attr('font-size', 9.5)
            .style('font-family', 'var(--font-mono)')
        })

      // Axis labels
      root.append('text').attr('x', ml + pw / 2).attr('y', H - 4)
        .attr('text-anchor', 'middle').attr('fill', COL_TER).attr('font-size', 9)
        .style('font-family', 'var(--font-sans)').attr('letter-spacing', '.1em')
        .text('NEWS SIGNAL SCORE (0-100)')

      root.append('text').attr('transform', `translate(10,${mt + ph / 2})rotate(-90)`)
        .attr('text-anchor', 'middle').attr('fill', COL_TER).attr('font-size', 9)
        .style('font-family', 'var(--font-sans)').attr('letter-spacing', '.1em')
        .text('LORO SCORE')

      // Leader lines
      const ldrG = g.append('g').attr('pointer-events', 'none')
      entities.forEach((e, i) => {
        const lx   = labelNodes[i].x, ly = labelNodes[i].y
        const dx   = dotPos[i].x,     dy = dotPos[i].y
        const dist = Math.sqrt((lx - dx) ** 2 + (ly - dy) ** 2)
        if (dist < 8) return
        const r  = rSc(e.regulatory_events_7d ?? 0) + 1
        const ux = (lx - dx) / dist, uy = (ly - dy) / dist
        ldrG.append('line')
          .attr('class', `ldr-${i}`)
          .attr('x1', dx + ux * r).attr('y1', dy + uy * r)
          .attr('x2', lx).attr('y2', ly)
          .attr('stroke', dotColor(e))
          .attr('stroke-width', e === highlighted ? 0.8 : 0.4)
          .attr('opacity', e === highlighted ? 0.7 : 0.5)
      })

      // Dots
      const nodeG = g.append('g')
      const nodes = nodeG.selectAll('.nd').data(entities).join('g')
        .attr('class', 'nd')
        .attr('transform', (_, i) =>
          `translate(${dotPos[i].x.toFixed(1)},${dotPos[i].y.toFixed(1)})`)
        .style('cursor', 'pointer')

      nodes.append('circle').attr('class', 'dot')
        .attr('r', 0)
        .attr('fill', d => dotColor(d))
        .attr('fill-opacity', d => d === highlighted ? 1 : 0.72)
        .attr('stroke', 'none')

      // Labels
      const lblG = g.append('g').attr('pointer-events', 'none')
      entities.forEach((e, i) => {
        const lx   = labelNodes[i].x, ly = labelNodes[i].y
        const cn   = cleanName(e.entity_name)
        const wH   = labelW(cn) / 2
        const toRight = lx > dotPos[i].x
        const anchor  = toRight ? 'start' : 'end'
        const ax      = anchor === 'start' ? lx - wH : lx + wH

        lblG.append('text').attr('class', `lbl-n-${i}`)
          .attr('x', ax).attr('y', ly - 2)
          .attr('text-anchor', anchor)
          .attr('fill', e === highlighted ? RED : COL_SEC)
          .attr('font-size', e === highlighted ? 11 : 10)
          .style('font-family', 'var(--font-sans)')
          .attr('font-weight', e === highlighted ? '500' : '400')
          .text(cn)

        lblG.append('text').attr('class', `lbl-s-${i}`)
          .attr('x', ax).attr('y', ly + 10)
          .attr('text-anchor', anchor)
          .attr('fill', e === highlighted ? RED : COL_TER)
          .attr('font-size', 10)
          .style('font-family', 'var(--font-mono)')
          .text(Math.round(e.loro_score))
      })

      // -- Interactions ----------------------------------------------
      nodes.on('mouseenter', function(_, d) {
        d3.select(this).select('.dot')
          .attr('stroke', dotColor(d)).attr('stroke-width', 2).attr('fill-opacity', 1)
        nodes.filter(n => n !== d).select('.dot')
          .transition().duration(100).attr('fill-opacity', 0.12)
        ldrG.selectAll('line').transition().duration(100).attr('opacity', 0.08)
        lblG.selectAll('text').transition().duration(100).attr('opacity', 0.15)
        const i = entities.indexOf(d)
        ldrG.select(`.ldr-${i}`).attr('opacity', 1)
        lblG.select(`.lbl-n-${i}`).attr('opacity', 1)
        lblG.select(`.lbl-s-${i}`).attr('opacity', 1)
        setSelected(d)
      }).on('mouseleave', function() {
        const j = activeJur
        nodes.select('.dot').transition().duration(150)
          .attr('stroke', 'none')
          .attr('fill-opacity', (d: EntityScore) =>
            j === 'all' || d.jurisdiction === j ? (d === highlighted ? 1 : 0.72) : 0.1)
        ldrG.selectAll('line').transition().duration(150).attr('opacity', 0.5)
        lblG.selectAll('text').transition().duration(150).attr('opacity', 1)
        setSelected(null)
      })

      // Animate in
      nodes.select('.dot').transition().duration(700).delay((_, i) => i * 48)
        .attrTween('r', function(d: EntityScore) {
          const base = rSc(d.regulatory_events_7d ?? 0)
          const r    = Math.max(base, d === highlighted ? 7 : 4.5)
          return (t: number) => String(d3.easeBackOut.overshoot(1.3)(t) * r)
        })
    })
  }, [entities, activeJur]) // eslint-disable-line

  const dirLabel = (d: string | null) =>
    ({ mixed: 'Mixed insider activity', buying: 'Insiders buying', selling: 'Insiders selling' }
      [d ?? ''] ?? '')

  return (
    <div>
      {/* Jurisdiction filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {['all', 'GB', 'US', 'EU'].map(j => (
          <button key={j} onClick={() => setActiveJur(j)}
            style={{
              padding: '2px 11px', borderRadius: 20, fontSize: 10, cursor: 'pointer',
              letterSpacing: '.04em', transition: 'all .12s',
              border: '0.5px solid var(--color-border-secondary)',
              background: activeJur === j ? 'var(--color-background-secondary)' : 'transparent',
              color: activeJur === j ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
            }}>
            {j === 'all' ? 'All' : j}
          </button>
        ))}
      </div>

      {/* Chart + detail panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 190px' }}>
        <svg ref={svgRef} width="100%" style={{ display: 'block', overflow: 'visible' }} />

        <div style={{ borderLeft: '0.5px solid var(--color-border-tertiary)', padding: '16px' }}>
          <div style={{ fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase',
            color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
            Entity detail
          </div>

          {!selected ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.7, marginTop: 6 }}>
              Hover any entity to explore its score breakdown
            </div>
          ) : (
            <>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 500,
                color: selected === highlighted ? '#A32D2D' : 'var(--color-text-primary)',
                lineHeight: 1.2, marginBottom: 2 }}>
                {selected.entity_name}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)',
                letterSpacing: '.06em', marginBottom: 12 }}>
                {selected.jurisdiction}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 44, fontWeight: 500,
                lineHeight: 1, letterSpacing: '-.02em',
                color: selected === highlighted ? '#A32D2D' : '#1A3A6B' }}>
                {Math.round(selected.loro_score)}
              </div>
              <div style={{ fontSize: 9, letterSpacing: '.08em',
                color: 'var(--color-text-tertiary)', marginBottom: 14 }}>
                {selected.score_delta != null
                  ? `${selected.score_delta > 0 ? '+' : ''}${selected.score_delta.toFixed(1)} from yesterday`
                  : 'Day 1 - baseline establishing'}
              </div>
              <div style={{ height: '.5px', background: 'var(--color-border-tertiary)', marginBottom: 12 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {BARS.map(b => (
                  <div key={b.l}>
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                      fontSize: 9.5, marginBottom: 3 }}>
                      <span style={{ color: 'var(--color-text-tertiary)' }}>{b.l}</span>
                      <span style={{ fontFamily: 'var(--font-mono)',
                        color: 'var(--color-text-secondary)' }}>
                        {Math.round(selected[b.k] ?? 50)}
                      </span>
                    </div>
                    <div style={{ height: 1.5, background: 'var(--color-border-tertiary)' }}>
                      <div style={{ height: 1.5, width: `${selected[b.k] ?? 50}%`,
                        background: b.c }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, paddingTop: 10,
                borderTop: '.5px solid var(--color-border-tertiary)',
                fontSize: 10, color: 'var(--color-text-tertiary)', lineHeight: 1.8 }}>
                {(selected.regulatory_events_7d ?? 0) > 0 && (
                  <div>{selected.regulatory_events_7d} regulatory filing
                    {selected.regulatory_events_7d !== 1 ? 's' : ''} (7d)
                  </div>
                )}
                {selected.avg_anomaly_score_7d != null && (
                  <div>Avg anomaly {selected.avg_anomaly_score_7d.toFixed(1)}/10</div>
                )}
                {dirLabel(selected.insider_direction) && (
                  <div>{dirLabel(selected.insider_direction)}</div>
                )}
                {selected.alert_triggered && (
                  <div style={{ color: '#A32D2D', fontWeight: 500 }}>Alert triggered</div>
                )}
              </div>
              <a href={`/companies/${selected.entity_slug}`}
                style={{ display: 'block', marginTop: 12, fontSize: 10,
                  color: '#1A3A6B', letterSpacing: '.04em', textDecoration: 'none' }}>
                Full entity page
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
