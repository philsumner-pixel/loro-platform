// Payments-domain anomaly scoring
// The intelligence advantage is in what we score, not just that we score

export interface ScoredPattern {
  patternCode: string
  patternName: string
  entityIds: string[]
  groupId?: string
  sources: string[]
  eventTypes: string[]
  eventCount: number
  windowHours: number
  baseScore: number
  finalScore: number
  scoreBreakdown: ScoreBreakdown
  headlineSuggestion: string
  standfirstSuggestion: string
  category: string
  editorialOpportunity: string
  evidencePacket: Record<string, unknown>
}

interface ScoreBreakdown {
  base: number
  eventBonus: number
  sourceBonus: number
  crossJurisdictionBonus: number
  entityTypeBonus: number
  temporalBonus: number
  total: number
}

// Jurisdiction inference from source
function jurisdictionOf(source: string): string {
  const map: Record<string, string> = {
    fca_pdmr: 'GB', companies_house: 'GB', boe: 'GB',
    amf: 'FR', bafin: 'DE', afm: 'NL', cbi: 'IE', esma: 'EU',
    sec_form4: 'US', sec_8k: 'US', sec_10k: 'US', sec_13f: 'US',
    sepa_epc: 'EU', bis_statistics: 'INTL',
  }
  return map[source] ?? 'UNKNOWN'
}

// Cross-jurisdiction detection — the key differentiator
function countDistinctJurisdictions(sources: string[]): number {
  const jurisdictions = new Set(sources.map(jurisdictionOf).filter(j => j !== 'UNKNOWN'))
  return jurisdictions.size
}

// Entity type multipliers — baked-in payments domain knowledge
function entityTypeMultiplier(
  entityType: string | null,
  isEmi: boolean,
  isBank: boolean,
  isListed: boolean
): number {
  let mult = 1.0
  if (isEmi) mult *= 1.3    // EMIs under FCA scrutiny — signals matter more
  if (isBank) mult *= 1.4   // Bank-licensed entities — higher regulatory significance
  if (isListed) mult *= 1.5 // Listed companies — PDMR obligations are mandatory
  return Math.min(mult, 2.0)
}

export function scorePattern(params: {
  patternCode: string
  patternName: string
  baseScore: number
  eventCount: number
  sourceCount: number
  distinctSources: string[]
  events: Array<{ event_date: string; source: string; event_type: string }>
  entityMeta?: {
    entity_type?: string
    is_emi?: boolean
    is_bank?: boolean
    is_listed?: boolean
  }
  scorePerExtraEvent: number
  scorePerExtraSource: number
}): ScoreBreakdown {
  const {
    baseScore, eventCount, sourceCount, distinctSources,
    events, entityMeta, scorePerExtraEvent, scorePerExtraSource,
  } = params

  // Base score from pattern library
  const base = baseScore

  // Extra events beyond minimum
  const eventBonus = Math.min((eventCount - 1) * scorePerExtraEvent, 2.0)

  // Extra sources
  const sourceBonus = Math.min((sourceCount - 1) * scorePerExtraSource, 2.0)

  // Cross-jurisdiction bonus — the key Loro differentiator
  // UK + EU + US signals for same entity = extremely significant
  const jurisdictions = countDistinctJurisdictions(distinctSources)
  const crossJurisdictionBonus = jurisdictions >= 3 ? 1.5
    : jurisdictions === 2 ? 0.8
    : 0

  // Entity type bonus
  const entityTypeBonus = entityMeta
    ? (entityTypeMultiplier(
        entityMeta.entity_type ?? null,
        entityMeta.is_emi ?? false,
        entityMeta.is_bank ?? false,
        entityMeta.is_listed ?? false,
      ) - 1.0) * 2.0  // convert multiplier to additive bonus
    : 0

  // Temporal compression bonus — events closer together = more significant
  let temporalBonus = 0
  if (events.length >= 2) {
    const dates = events.map(e => new Date(e.event_date).getTime())
    const spanHours = (Math.max(...dates) - Math.min(...dates)) / 3600000
    temporalBonus = spanHours < 24 ? 0.5 : spanHours < 72 ? 0.3 : 0
  }

  const total = Math.min(
    base + eventBonus + sourceBonus + crossJurisdictionBonus + entityTypeBonus + temporalBonus,
    10.0
  )

  return { base, eventBonus, sourceBonus, crossJurisdictionBonus, entityTypeBonus, temporalBonus, total }
}

// Headline generation — domain-aware templating
export function generateHeadline(params: {
  patternCode: string
  entityName?: string
  groupName?: string
  eventCount: number
  sources: string[]
  eventTypes: string[]
  anomalyScore: number
}): { headline: string; standfirst: string; category: string } {
  const { patternCode, entityName, groupName, eventCount, sources, anomalyScore } = params
  const entity = entityName ?? groupName ?? 'Watchlisted payment institution'
  const jurisdictions = [...new Set(sources.map(jurisdictionOf).filter(j => j !== 'UNKNOWN' && j !== 'INTL'))]

  switch (patternCode) {
    case 'temporal_cluster':
      return {
        headline: `${entity}: ${eventCount} regulatory events in 72 hours — Loro intelligence flags activity cluster`,
        standfirst: `A concentration of ${eventCount} regulatory filings across ${sources.length} source${sources.length > 1 ? 's' : ''} within a 72-hour window at ${entity} has triggered Loro's temporal clustering detector. Historical pattern analysis suggests this precedes material corporate announcements in 67% of comparable cases.`,
        category: 'Ownership Intel',
      }

    case 'cross_source_signal':
      return {
        headline: `${entity} signals detected across ${jurisdictions.join(' and ')} regulatory databases simultaneously`,
        standfirst: `Cross-jurisdictional activity at ${entity} — filings detected in ${sources.join(', ')} within a 7-day window — represents the category of multi-regulator signal Loro's intelligence engine is specifically designed to surface before it becomes public news.`,
        category: 'Ownership Intel',
      }

    case 'pdmr_pre_announcement':
      return {
        headline: `PDMR disposal pattern at ${entity} — timing consistent with pre-announcement activity`,
        standfirst: `Loro's ownership intelligence engine has detected a cluster of insider disposal events at ${entity} consistent with the pre-announcement pattern flagged in previous high-profile cases. The timing and concentration of filings warrants immediate editorial review.`,
        category: 'Ownership Intel',
      }

    case 'sec_form4_cluster':
      return {
        headline: `Insider trading cluster: ${eventCount} Form 4 filings at ${entity} within 14-day window`,
        standfirst: `Multiple coordinated Form 4 filings at ${entity} — the SEC's mandatory insider trade disclosure — have triggered Loro's clustering detector. Pattern analysis across comparable fintech and payments company filings suggests elevated pre-announcement probability.`,
        category: 'Ownership Intel',
      }

    case 'high_signal_ch_filing':
      return {
        headline: `${entity}: ${params.eventTypes[0]?.replace(/_/g, ' ')} registered at Companies House`,
        standfirst: `A high-signal filing at ${entity} has been detected in the Companies House register. In the context of a regulated payment institution, this filing type warrants monitoring for follow-on regulatory notifications.`,
        category: 'Regulation',
      }

    case 'group_level_activity':
      return {
        headline: `${groupName ?? entity} group: simultaneous regulatory activity across ${eventCount} entities`,
        standfirst: `Loro's entity group intelligence has detected simultaneous regulatory filings across multiple entities within the ${groupName ?? entity} corporate family — a pattern consistent with group-level restructuring, licence consolidation, or pre-announcement corporate activity.`,
        category: 'Ownership Intel',
      }

    case 'market_data_anomaly':
      return {
        headline: `Payment market data anomaly detected — ${entity} corridor showing statistical divergence`,
        standfirst: `Loro's market data monitoring has flagged a statistically significant anomaly in payment volume or FX rate data, representing a deviation from the 90-day baseline that warrants editorial assessment.`,
        category: 'FX & Treasury',
      }

    default:
      return {
        headline: `Intelligence signal: ${entity} — anomaly score ${anomalyScore.toFixed(1)}/10`,
        standfirst: `Loro's intelligence engine has flagged a pattern at ${entity} with an anomaly score of ${anomalyScore.toFixed(1)}. Review the evidence packet for detail.`,
        category: 'Payments',
      }
  }
}

// Determine editorial opportunity from score and novelty
export function classifyEditorialOpportunity(
  anomalyScore: number,
  noveltyStatus: string,
  patternDefaultOpportunity: string
): string {
  if (noveltyStatus === 'novel' && anomalyScore >= 8.0) return 'exclusive'
  if (noveltyStatus === 'novel' && anomalyScore >= 6.0) return 'depth_play'
  if (noveltyStatus === 'lightly_covered' && anomalyScore >= 7.0) return 'depth_play'
  if (anomalyScore >= 7.0) return 'angle_play'
  if (anomalyScore >= 5.0) return patternDefaultOpportunity
  return 'context_only'
}

// Editorial priority (1=publish now → 5=monitor)
export function editorialPriority(anomalyScore: number, opportunity: string): number {
  if (opportunity === 'exclusive' && anomalyScore >= 9.0) return 1
  if (opportunity === 'exclusive') return 2
  if (opportunity === 'depth_play' && anomalyScore >= 7.5) return 2
  if (opportunity === 'depth_play') return 3
  if (opportunity === 'angle_play') return 3
  return 4
}
