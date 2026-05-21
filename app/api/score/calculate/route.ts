import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Loro Payment Intelligence Score calculator
// Runs daily at 08:00 UTC (after overnight data collection)
// Computes composite 0-100 score per entity from five signal components

export const runtime = 'nodejs'
export const maxDuration = 55

const WEIGHTS = {
  regulatory: 0.35,
  sentiment:  0.25,
  news:       0.20,
  ownership:  0.15,
  market:     0.05,
}

const ALERT_THRESHOLD = 10  // points moved in 48 hours

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Normalise a raw value to 0-100 given a min/max range
function normalise(value: number, min: number, max: number): number {
  if (max === min) return 50
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

async function computeRegulatoryScore(sb: ReturnType<typeof getSupabase>, entityId: string) {
  const since7d = new Date(Date.now() - 7 * 86400000).toISOString()
  const since30d = new Date(Date.now() - 30 * 86400000).toISOString()

  const { data: events7d } = await sb
    .from('loro_source_events')
    .select('id')
    .eq('entity_id', entityId)
    .gt('created_at', since7d)

  const { data: events30d } = await sb
    .from('loro_source_events')
    .select('id')
    .eq('entity_id', entityId)
    .gt('created_at', since30d)

  const { data: candidates } = await sb
    .from('loro_story_candidates')
    .select('anomaly_score')
    .contains('entity_ids', [entityId])
    .gt('detected_at', since7d)
    .not('anomaly_score', 'is', null)

  const count7d = events7d?.length ?? 0
  const count30d = events30d?.length ?? 0
  const dailyBaseline = (count30d / 30)
  const dailyActual = count7d / 7

  // Activity ratio vs baseline
  const activityRatio = dailyBaseline > 0
    ? dailyActual / dailyBaseline
    : count7d > 0 ? 2 : 0

  // Average anomaly score of recent candidates
  const avgAnomaly = candidates?.length
    ? candidates.reduce((s, c) => s + (c.anomaly_score ?? 0), 0) / candidates.length
    : 0

  // Combine: normalise activity ratio (0-5x = 0-100) + weight by anomaly score
  const activityScore = normalise(activityRatio, 0, 4) * 0.5
  const anomalyScore = normalise(avgAnomaly, 0, 10) * 0.5
  const score = activityScore + anomalyScore

  return {
    score: Math.min(100, score),
    events7d: count7d,
    avgAnomaly: parseFloat(avgAnomaly.toFixed(2)),
  }
}

async function computeSentimentScore(sb: ReturnType<typeof getSupabase>, entityId: string) {
  const since7d = new Date(Date.now() - 7 * 86400000).toISOString()

  const { data: posts } = await sb
    .from('loro_sentiment_events')
    .select('sentiment, intensity, confidence, upvotes, posted_at')
    .eq('entity_id', entityId)
    .gt('posted_at', since7d)
    .not('sentiment', 'is', null)

  if (!posts?.length) return { score: 50, posts7d: 0, netSentiment: 0 }

  // Weight by upvotes and confidence and recency
  let positive = 0, negative = 0, totalWeight = 0
  const now = Date.now()

  for (const post of posts) {
    const ageHours = (now - new Date(post.posted_at).getTime()) / 3600000
    const recencyWeight = Math.exp(-ageHours / 48)  // half-life 48 hours
    const intensityMult = post.intensity === 'strong' ? 1.5 : post.intensity === 'moderate' ? 1.0 : 0.6
    const weight = (1 + Math.log1p(post.upvotes ?? 0)) * (post.confidence ?? 0.5) * intensityMult * recencyWeight

    if (post.sentiment === 'positive') positive += weight
    else if (post.sentiment === 'negative') negative += weight
    totalWeight += weight
  }

  const netSentiment = totalWeight > 0 ? (positive - negative) / totalWeight : 0
  // Map -1 to +1 range → 0-100, with 50 being neutral
  const score = 50 + (netSentiment * 50)

  return {
    score: Math.min(100, Math.max(0, score)),
    posts7d: posts.length,
    netSentiment: parseFloat(netSentiment.toFixed(3)),
  }
}

async function computeNewsScore(sb: ReturnType<typeof getSupabase>, entityName: string) {
  const since7d  = new Date(Date.now() - 7  * 86400000).toISOString()
  const since30d = new Date(Date.now() - 30 * 86400000).toISOString()

  // Count articles mentioning this entity (by headline match)
  const searchTerm = entityName.split(' ')[0]  // first word (e.g. 'PayPal', 'Revolut')

  const [r7, r30] = await Promise.all([
    sb.from('loro_news_coverage').select('id', { count: 'exact', head: true })
      .ilike('headline', `%${searchTerm}%`).gt('published_at', since7d),
    sb.from('loro_news_coverage').select('id', { count: 'exact', head: true })
      .ilike('headline', `%${searchTerm}%`).gt('published_at', since30d),
  ])

  const count7d  = r7.count ?? 0
  const count30d = r30.count ?? 0
  const daily7d  = count7d / 7
  const daily30d = count30d > 0 ? count30d / 30 : 0.1  // avoid division by zero

  // Velocity: how much faster is coverage than 30-day baseline?
  const velocity = daily7d / daily30d

  // Score: combine absolute volume (capped at 20 articles/week = 100) + velocity
  const volumeScore = normalise(count7d, 0, 20) * 0.5
  const velocityScore = normalise(velocity, 0, 5) * 0.5
  const score = volumeScore + velocityScore

  return {
    score: Math.min(100, score),
    articles7d: count7d,
    velocity: parseFloat(velocity.toFixed(2)),
  }
}

async function computeOwnershipScore(sb: ReturnType<typeof getSupabase>, entityId: string) {
  const since14d = new Date(Date.now() - 14 * 86400000).toISOString()

  const { data: pdmr } = await sb
    .from('loro_source_events')
    .select('event_type, raw_content')
    .eq('entity_id', entityId)
    .in('source', ['fca_pdmr', 'sec_form4'])
    .gt('created_at', since14d)

  if (!pdmr?.length) return { score: 50, pdmr14d: 0, direction: 'none' as const }

  let buys = 0, sells = 0
  for (const evt of pdmr) {
    const signalType = evt.raw_content?.signal_type as string | undefined
    const evtType = evt.event_type as string
    if (signalType === 'acquisition' || evtType.includes('buy')) buys++
    else if (signalType === 'disposal' || evtType.includes('sell')) sells++
  }

  const total = pdmr.length
  const direction: 'buying' | 'selling' | 'mixed' | 'none' =
    total === 0 ? 'none'
    : sells > buys * 2 ? 'selling'
    : buys > sells * 2 ? 'buying'
    : 'mixed'

  // Disposals are a stronger signal than purchases (more likely pre-announcement)
  // High disposal = high score (more interesting to editorial)
  const activityScore = normalise(total, 0, 15) * 0.6
  const disposalWeight = total > 0 ? (sells / total) * 40 : 20  // disposals boost score
  const score = activityScore + disposalWeight

  return {
    score: Math.min(100, Math.max(0, score)),
    pdmr14d: total,
    direction,
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = getSupabase()
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

  const { data: entities } = await sb
    .from('loro_entities')
    .select('id, name, slug')
    .not('name', 'is', null)

  if (!entities?.length) return NextResponse.json({ message: 'No entities' })

  const scores: Array<{
    entity: string; score: number; delta: number | null; alert: boolean
  }> = []

  for (const entity of entities) {
    try {
      // Compute all components in parallel
      const [reg, sent, news, own] = await Promise.all([
        computeRegulatoryScore(sb, entity.id),
        computeSentimentScore(sb, entity.id),
        computeNewsScore(sb, entity.name),
        computeOwnershipScore(sb, entity.id),
      ])

      // Weighted composite
      const loroScore = (
        reg.score  * WEIGHTS.regulatory +
        sent.score * WEIGHTS.sentiment  +
        news.score * WEIGHTS.news       +
        own.score  * WEIGHTS.ownership  +
        50         * WEIGHTS.market     // market data placeholder — 50 = neutral
      )

      // Get yesterday's score for delta
      const { data: prev } = await sb
        .from('loro_entity_scores')
        .select('loro_score')
        .eq('entity_id', entity.id)
        .eq('score_date', yesterday)
        .single()

      const prevScore = prev?.loro_score ?? null
      const delta = prevScore != null ? loroScore - prevScore : null
      const alertTriggered = delta != null && Math.abs(delta) >= ALERT_THRESHOLD

      // Upsert score
      await sb.from('loro_entity_scores').upsert({
        entity_id: entity.id,
        score_date: today,
        loro_score: parseFloat(loroScore.toFixed(2)),
        score_prev: prevScore,
        score_delta: delta != null ? parseFloat(delta.toFixed(2)) : null,
        regulatory_score:  parseFloat(reg.score.toFixed(2)),
        sentiment_score:   parseFloat(sent.score.toFixed(2)),
        news_score:        parseFloat(news.score.toFixed(2)),
        ownership_score:   parseFloat(own.score.toFixed(2)),
        market_score:      50,
        regulatory_events_7d: reg.events7d,
        avg_anomaly_score_7d: reg.avgAnomaly,
        sentiment_posts_7d:   sent.posts7d,
        sentiment_net_7d:     sent.netSentiment,
        news_articles_7d:     news.articles7d,
        news_velocity:        news.velocity,
        pdmr_events_7d:       own.pdmr14d,
        insider_direction:    own.direction,
        alert_triggered:      alertTriggered,
        alert_reason: alertTriggered && delta != null
          ? `Score ${delta > 0 ? 'rose' : 'fell'} ${Math.abs(delta).toFixed(1)} points in 24 hours`
          : null,
        calculated_at: new Date().toISOString(),
      }, { onConflict: 'entity_id,score_date' })

      // Write alert if threshold crossed
      if (alertTriggered && delta !== null && prevScore !== null) {
        await sb.from('loro_score_alerts').insert({
          entity_id: entity.id,
          entity_name: entity.name,
          alert_type: delta > 0 ? 'spike' : 'drop',
          score_before: prevScore,
          score_after: parseFloat(loroScore.toFixed(2)),
          delta: parseFloat(delta.toFixed(2)),
        })
      }

      scores.push({
        entity: entity.name,
        score: parseFloat(loroScore.toFixed(1)),
        delta: delta != null ? parseFloat(delta.toFixed(1)) : null,
        alert: alertTriggered,
      })

    } catch {
      // Continue to next entity
    }
  }

  // Compute percentiles
  const allScores = scores.map(s => s.score).sort((a, b) => a - b)
  for (const { entity, score } of scores) {
    const percentile = allScores.length > 1
      ? (allScores.filter(s => s <= score).length / allScores.length) * 100
      : 50

    const { data: ent } = await sb.from('loro_entities').select('id').eq('name', entity).single()
    if (ent) {
      await sb.from('loro_entity_scores')
        .update({ score_percentile: parseFloat(percentile.toFixed(1)) })
        .eq('entity_id', ent.id)
        .eq('score_date', today)
    }
  }

  return NextResponse.json({
    entities_scored: scores.length,
    date: today,
    scores: scores.sort((a, b) => b.score - a.score),
    alerts: scores.filter(s => s.alert).length,
  })
}
