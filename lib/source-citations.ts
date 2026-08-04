// Turn a candidate's evidence packet into verifiable primary-source citations.
//
// This is the machine-readable half of Loro's editorial claim: the story came
// from named primary documents, and here are the URLs. Answer engines weight
// primary-source attribution heavily, and almost no publisher can emit this
// because they don't hold structured provenance.

export interface SourceCitation {
  url: string
  title: string
  publisher: string
  date?: string
  identifier?: string
}

interface EvidenceEvent {
  date?: string
  type?: string
  source?: string
  metadata?: Record<string, unknown>
}

const PUBLISHER: Record<string, string> = {
  sec_form4: 'U.S. Securities and Exchange Commission',
  sec_8k: 'U.S. Securities and Exchange Commission',
  sec_10k: 'U.S. Securities and Exchange Commission',
  sec_daily_index: 'U.S. Securities and Exchange Commission',
  companies_house: 'Companies House',
  fca_pdmr: 'Financial Conduct Authority',
  bis_statistics: 'Bank for International Settlements',
}

/** EDGAR document URL from CIK + accession + primary document. */
function secUrl(meta: Record<string, unknown>): string | null {
  const cik = String(meta.cik ?? '').replace(/^0+/, '')
  const accession = String(meta.accession_number ?? '')
  if (!cik || !accession) return null

  const bare = accession.replace(/-/g, '')
  const doc = meta.primary_document ? String(meta.primary_document) : null

  return doc
    ? `https://www.sec.gov/Archives/edgar/data/${cik}/${bare}/${doc}`
    : `https://www.sec.gov/Archives/edgar/data/${cik}/${bare}/${accession}-index.htm`
}

function titleFor(ev: EvidenceEvent, meta: Record<string, unknown>): string {
  const company = meta.company_name ? String(meta.company_name) : null
  const form = meta.form ? `Form ${meta.form}` : (ev.type ?? 'Filing')
  return company ? `${company} — ${form}` : form
}

/**
 * Extract citations from an evidence packet. Only emits entries with a real,
 * resolvable URL — never a placeholder, since a broken citation is worse than
 * none for both readers and answer engines.
 */
export function citationsFromEvidence(
  evidence: unknown
): SourceCitation[] {
  if (!evidence || typeof evidence !== 'object') return []
  const packet = evidence as Record<string, unknown>

  const events = Array.isArray(packet.events) ? (packet.events as EvidenceEvent[]) : []
  const out: SourceCitation[] = []
  const seen = new Set<string>()

  for (const ev of events) {
    const meta = (ev.metadata ?? {}) as Record<string, unknown>
    const source = ev.source ?? ''

    let url: string | null = null
    if (source.startsWith('sec_')) url = secUrl(meta)
    else if (typeof meta.url === 'string') url = meta.url

    if (!url || seen.has(url)) continue
    seen.add(url)

    out.push({
      url,
      title: titleFor(ev, meta),
      publisher: PUBLISHER[source] ?? source.replace(/_/g, ' '),
      date: ev.date,
      identifier: meta.accession_number ? String(meta.accession_number) : undefined,
    })
  }

  return out
}
