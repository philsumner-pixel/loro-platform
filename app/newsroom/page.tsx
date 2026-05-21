'use client'

import { useState, useEffect, useCallback } from 'react'

interface EvidencePacket {
  timeline?: Array<{ date: string; event: string }>
  filings?: string[]
  entities?: string[]
  sources?: string[]
  data_source?: string
  confidence?: string
  pattern_matches?: number
  [key: string]: unknown
}

interface Candidate {
  id: string
  headline: string
  standfirst: string | null
  ai_brief: string | null
  category: string
  anomaly_score: number | null
  novelty_status: string
  novelty_note: string | null
  editorial_opportunity: string | null
  editorial_priority: number | null
  loro_angle_hypothesis: string | null
  coverage_gaps: string | null
  coverage_summary: string | null
  status: string
  assigned_to: string | null
  published_slug: string | null
  published_at: string | null
  evidence_packet: EvidencePacket
  detected_at: string
}

interface DraftState {
  candidateId: string
  headline: string
  standfirst: string
  body: string
  category: string
}

const TABS = [
  { key: 'new,shortlisted', label: 'Inbox', statuses: ['new', 'shortlisted'] },
  { key: 'in_draft', label: 'In draft', statuses: ['in_draft'] },
  { key: 'published', label: 'Published', statuses: ['published'] },
]

function oppLabel(s: string | null): string {
  if (!s) return 'Unassessed'
  return { exclusive: 'Exclusive', depth_play: 'Depth play', angle_play: 'Angle play', context_only: 'Context only', watch: 'Watching' }[s] ?? 'Unassessed'
}

function priorityLabel(p: number | null): string {
  if (!p) return ''
  return { 1: 'Publish now', 2: 'Publish today', 3: 'This week', 4: 'When capacity', 5: 'Monitor' }[p] ?? ''
}

function priorityClass(p: number | null): string {
  if (!p || p >= 3) return 'p3'
  if (p === 2) return 'p2'
  return 'p1'
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (d > 0) return `${d}d ago`
  if (h > 0) return `${h}h ago`
  return 'Just now'
}

function scoreClass(score: number | null): string {
  if (!score) return 'low'
  if (score >= 8) return 'high'
  if (score >= 6) return 'mid'
  return 'low'
}

function noveltyClass(s: string): string {
  if (s === 'novel') return 'novel'
  if (s === 'lightly_covered') return 'lightly'
  if (s === 'widely_covered') return 'widely'
  return 'unchecked'
}

function noveltyLabel(s: string): string {
  if (s === 'novel') return 'Novel'
  if (s === 'lightly_covered') return 'Lightly covered'
  if (s === 'widely_covered') return 'Widely covered'
  return 'Not checked'
}

export default function NewsroomPage() {
  const [activeTab, setActiveTab] = useState(TABS[0])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Candidate | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setSelected(null)
    try {
      const res = await fetch(`/api/newsroom?status=${activeTab.key}`)
      const data = await res.json()
      setCandidates(data.candidates || [])
    } catch {
      setCandidates([])
    } finally {
      setLoading(false)
    }
  }, [activeTab.key])

  useEffect(() => { load() }, [load])

  function openDraft(c: Candidate) {
    setDraft({
      candidateId: c.id,
      headline: c.headline,
      standfirst: c.standfirst ?? '',
      body: c.ai_brief
        ? `<p>${c.ai_brief}</p>`
        : `<p>${c.standfirst ?? ''}</p>\n<p>[Write your article here]</p>`,
      category: c.category,
    })
    setPublishedUrl(null)
  }

  async function publishDraft() {
    if (!draft) return
    setPublishing(true)
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_id: draft.candidateId,
          headline: draft.headline,
          standfirst: draft.standfirst,
          body_html: draft.body,
          category: draft.category,
          publication_tier: 'section',
        }),
      })
      const data = await res.json()
      if (data.slug) {
        setPublishedUrl(data.url)
        setDraft(null)
        await load()
      }
    } finally {
      setPublishing(false)
    }
  }

  async function updateStatus(id: string, status: string, extra: Record<string, string> = {}) {
    setUpdating(id)
    try {
      await fetch('/api/newsroom', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, ...extra }),
      })
      await load()
    } finally {
      setUpdating(null)
    }
  }

  const counts = {
    inbox: candidates.filter(c => ['new', 'shortlisted'].includes(c.status)).length,
    draft: candidates.filter(c => c.status === 'in_draft').length,
    published: candidates.filter(c => c.status === 'published').length,
  }

  return (
    <div className="loro-newsroom">

      {/* Header */}
      <div className="loro-nr-header">
        <div className="loro-nr-header-inner">
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span className="loro-nr-wordmark">Loro</span>
            <span className="loro-nr-badge">Newsroom</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <a href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.04em' }}>
              ← View site
            </a>
            <span className="loro-nr-user">Chris Cannon</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="loro-nr-tabs">
        <div className="loro-nr-tabs-inner">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`loro-nr-tab${activeTab.key === tab.key ? ' active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.label}
              <span className="loro-nr-tab-count">
                {tab.key === 'new,shortlisted'
                  ? candidates.filter(c => ['new', 'shortlisted'].includes(c.status)).length
                  : candidates.filter(c => tab.statuses.includes(c.status)).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="loro-nr-body">

        {/* Stats */}
        {activeTab.key === 'new,shortlisted' && (
          <div className="loro-nr-stats">
            <div className="loro-nr-stat">
              <div className="loro-nr-stat-lbl">In inbox</div>
              <div className="loro-nr-stat-val">{candidates.filter(c => c.status === 'new').length}</div>
            </div>
            <div className="loro-nr-stat">
              <div className="loro-nr-stat-lbl">Shortlisted</div>
              <div className="loro-nr-stat-val">{candidates.filter(c => c.status === 'shortlisted').length}</div>
            </div>
            <div className="loro-nr-stat">
              <div className="loro-nr-stat-lbl">Novel signals</div>
              <div className="loro-nr-stat-val">{candidates.filter(c => c.novelty_status === 'novel').length}</div>
            </div>
            <div className="loro-nr-stat">
              <div className="loro-nr-stat-lbl">Avg anomaly score</div>
              <div className="loro-nr-stat-val">
                {candidates.length
                  ? (candidates.reduce((s, c) => s + (c.anomaly_score || 0), 0) / candidates.length).toFixed(1)
                  : '—'}
              </div>
            </div>
          </div>
        )}

        {/* Draft editor */}
        {draft && (
          <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderLeft: '3px solid var(--blue)', padding: '28px 32px', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div className="loro-nr-detail-section-title" style={{ margin: 0 }}>Draft editor</div>
              <button className="loro-nr-btn" onClick={() => setDraft(null)}>Discard draft</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink5)', display: 'block', marginBottom: 6 }}>Headline</label>
                <input
                  value={draft.headline}
                  onChange={e => setDraft(d => d ? { ...d, headline: e.target.value } : null)}
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', fontFamily: "'Playfair Display', serif", fontSize: 17, fontWeight: 600, color: 'var(--ink)', background: 'var(--paper)', outline: 'none' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink5)', display: 'block', marginBottom: 6 }}>Standfirst</label>
                <textarea
                  value={draft.standfirst}
                  onChange={e => setDraft(d => d ? { ...d, standfirst: e.target.value } : null)}
                  rows={2}
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', fontFamily: "'Inter', sans-serif", fontSize: 14, color: 'var(--ink3)', background: 'var(--paper)', outline: 'none', resize: 'vertical' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink5)', display: 'block', marginBottom: 6 }}>
                  Article body (HTML or plain text — &lt;p&gt; tags for paragraphs)
                </label>
                <textarea
                  value={draft.body}
                  onChange={e => setDraft(d => d ? { ...d, body: e.target.value } : null)}
                  rows={16}
                  style={{ width: '100%', padding: '12px 14px', border: '1px solid var(--border)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink)', background: 'var(--paper2)', outline: 'none', resize: 'vertical', lineHeight: 1.7 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  className="loro-nr-btn success"
                  style={{ padding: '10px 28px', fontSize: 13 }}
                  disabled={publishing || !draft.headline || !draft.body}
                  onClick={publishDraft}
                >
                  {publishing ? 'Publishing…' : 'Publish →'}
                </button>
                <span style={{ fontSize: 12, color: 'var(--ink5)' }}>
                  Goes live immediately at /news/[slug]
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Published confirmation */}
        {publishedUrl && (
          <div style={{ background: '#EEFAF2', border: '1px solid #C2E8CF', padding: '14px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: '#1E6B3A', fontWeight: 500 }}>Article published successfully</span>
            <a href={publishedUrl} style={{ fontSize: 13, color: '#1E6B3A', fontWeight: 500 }}>
              View live article →
            </a>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="loro-nr-empty">Loading candidates…</div>
        )}

        {/* Empty */}
        {!loading && candidates.length === 0 && (
          <div className="loro-nr-empty">
            No candidates in this queue.
          </div>
        )}

        {/* Candidate list */}
        {!loading && candidates.length > 0 && (
          <div className="loro-nr-list">
            {candidates.map(c => (
              <div key={c.id}>
                <div
                  className={`loro-nr-row${selected?.id === c.id ? ' selected' : ''}`}
                  onClick={() => setSelected(selected?.id === c.id ? null : c)}
                >
                  <div className="loro-nr-row-left">
                    <div className="loro-nr-row-meta">
                      <span className="loro-nr-cat">{c.category}</span>
                      {c.editorial_opportunity && (
                        <span className={`loro-nr-opp ${c.editorial_opportunity}`}>
                          {oppLabel(c.editorial_opportunity)}
                        </span>
                      )}
                      {c.anomaly_score && (
                        <span className={`loro-nr-score ${scoreClass(c.anomaly_score)}`}>
                          Score {c.anomaly_score.toFixed(1)}
                        </span>
                      )}
                      <span className={`loro-nr-novelty ${noveltyClass(c.novelty_status)}`}>
                        {noveltyLabel(c.novelty_status)}
                      </span>
                      {c.editorial_priority && (
                        <span className={`loro-nr-priority ${priorityClass(c.editorial_priority)}`}>
                          {priorityLabel(c.editorial_priority)}
                        </span>
                      )}
                      {c.status === 'shortlisted' && (
                        <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--blue-mid)' }}>
                          Shortlisted
                        </span>
                      )}
                    </div>
                    <div className="loro-nr-headline">{c.headline}</div>
                    {c.standfirst && (
                      <div className="loro-nr-standfirst">{c.standfirst}</div>
                    )}
                    <div className="loro-nr-age">Detected {timeAgo(c.detected_at)}</div>
                  </div>

                  <div className="loro-nr-row-actions" onClick={e => e.stopPropagation()}>
                    {c.status === 'new' && (
                      <>
                        <button
                          className="loro-nr-btn primary"
                          disabled={updating === c.id}
                          onClick={() => updateStatus(c.id, 'shortlisted')}
                        >
                          Shortlist →
                        </button>
                        <button
                          className="loro-nr-btn danger"
                          disabled={updating === c.id}
                          onClick={() => updateStatus(c.id, 'discarded', { discard_reason: 'Not relevant' })}
                        >
                          Discard
                        </button>
                      </>
                    )}
                    {c.status === 'shortlisted' && (
                      <>
                        <button
                          className="loro-nr-btn success"
                          disabled={updating === c.id}
                          onClick={() => { updateStatus(c.id, 'in_draft'); openDraft(c) }}
                        >
                          Take to draft
                        </button>
                        <button
                          className="loro-nr-btn danger"
                          disabled={updating === c.id}
                          onClick={() => updateStatus(c.id, 'discarded', { discard_reason: 'Deprioritised' })}
                        >
                          Discard
                        </button>
                      </>
                    )}
                    {c.status === 'in_draft' && (
                      <span style={{ fontSize: 12, color: 'var(--ink5)' }}>In progress</span>
                    )}
                    {c.status === 'published' && c.published_slug && (
                      <a
                        href={`/news/${c.published_slug}`}
                        style={{ fontSize: 12, fontWeight: 500, color: 'var(--blue-mid)', letterSpacing: '0.02em' }}
                        onClick={e => e.stopPropagation()}
                      >
                        Read article →
                      </a>
                    )}
                  </div>
                </div>

                {/* Expanded detail panel */}
                {selected?.id === c.id && (
                  <div className="loro-nr-detail">
                    <div className="loro-nr-detail-headline">{c.headline}</div>
                    {c.standfirst && (
                      <div className="loro-nr-detail-standfirst">{c.standfirst}</div>
                    )}

                    <div className="loro-nr-detail-grid">
                      {/* Timeline */}
                      <div>
                        <div className="loro-nr-detail-section-title">Evidence timeline</div>
                        <div className="loro-nr-timeline">
                          {(c.evidence_packet?.timeline || []).map((item, i) => (
                            <div key={i} className="loro-nr-tl-item">
                              <span className="loro-nr-tl-date">{item.date}</span>
                              <span className="loro-nr-tl-event">{item.event}</span>
                            </div>
                          ))}
                          {!c.evidence_packet?.timeline && (
                            <span style={{ fontSize: 13, color: 'var(--ink5)' }}>No timeline data</span>
                          )}
                        </div>
                      </div>

                      {/* Signal data */}
                      <div>
                        <div className="loro-nr-detail-section-title">Signal data</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {c.anomaly_score && (
                            <div>
                              <span style={{ fontSize: 11, color: 'var(--ink5)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Anomaly score</span>
                              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 28, fontWeight: 500, color: 'var(--ink)', marginTop: 2 }}>
                                {c.anomaly_score.toFixed(1)}<span style={{ fontSize: 14, color: 'var(--ink5)' }}>/10</span>
                              </div>
                            </div>
                          )}
                          <div>
                            <span style={{ fontSize: 11, color: 'var(--ink5)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Novelty</span>
                            <div style={{ marginTop: 4 }}>
                              <span className={`loro-nr-novelty ${noveltyClass(c.novelty_status)}`}>
                                {noveltyLabel(c.novelty_status)}
                              </span>
                            </div>
                            {c.novelty_note && (
                              <div style={{ fontSize: 12, color: 'var(--ink4)', lineHeight: 1.6, marginTop: 8 }}>
                                {c.novelty_note}
                              </div>
                            )}
                          </div>
                          {c.evidence_packet?.confidence && (
                            <div>
                              <span style={{ fontSize: 11, color: 'var(--ink5)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Confidence</span>
                              <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2 }}>{c.evidence_packet.confidence as string}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Loro angle */}
                    {(c.loro_angle_hypothesis || c.coverage_summary || c.coverage_gaps) && (
                      <div style={{ marginBottom: 24 }}>
                        {c.editorial_opportunity && c.editorial_opportunity !== 'exclusive' && c.coverage_summary && (
                          <>
                            <div className="loro-nr-detail-section-title">What others covered</div>
                            <div style={{ fontSize: 13, color: 'var(--ink4)', lineHeight: 1.65, marginBottom: 12, padding: '10px 14px', background: 'var(--paper2)', border: '1px solid var(--border)' }}>
                              {c.coverage_summary}
                            </div>
                          </>
                        )}
                        {c.loro_angle_hypothesis && (
                          <div className="loro-nr-angle-box">
                            <div className="loro-nr-angle-title">
                              {c.editorial_opportunity === 'exclusive' ? 'Why this is exclusive' :
                               c.editorial_opportunity === 'depth_play' ? 'The depth play' :
                               c.editorial_opportunity === 'angle_play' ? 'The Loro angle' :
                               'Editorial note'}
                            </div>
                            <div className="loro-nr-angle-text">{c.loro_angle_hypothesis}</div>
                          </div>
                        )}
                        {c.coverage_gaps && c.editorial_opportunity !== 'exclusive' && (
                          <div style={{ fontSize: 12, color: 'var(--ink4)', lineHeight: 1.6, marginTop: 8 }}>
                            <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>Gaps in existing coverage: </strong>
                            {c.coverage_gaps}
                          </div>
                        )}
                      </div>
                    )}

                    {/* AI Brief */}
                    <div className="loro-nr-detail-section-title">AI brief</div>
                    <div className="loro-nr-brief">
                      {c.ai_brief ? (
                        c.ai_brief
                      ) : (
                        <span className="loro-nr-brief-placeholder">
                          Brief not yet generated. When the Loro intelligence engine produces a 75% draft, it will appear here for you to take into your own writing workflow.
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="loro-nr-detail-actions">
                      {c.status === 'new' && (
                        <>
                          <button className="loro-nr-btn primary" onClick={() => updateStatus(c.id, 'shortlisted')}>
                            Shortlist this story →
                          </button>
                          <button className="loro-nr-btn danger" onClick={() => updateStatus(c.id, 'discarded', { discard_reason: 'Not relevant' })}>
                            Discard
                          </button>
                        </>
                      )}
                      {c.status === 'shortlisted' && (
                        <>
                          <button className="loro-nr-btn success" onClick={() => { updateStatus(c.id, 'in_draft'); openDraft(c) }}>
                            Take to draft
                          </button>
                          <button className="loro-nr-btn danger" onClick={() => updateStatus(c.id, 'discarded', { discard_reason: 'Deprioritised' })}>
                            Discard
                          </button>
                        </>
                      )}
                      {c.status === 'in_draft' && (
                        <button className="loro-nr-btn primary" onClick={() => openDraft(c)}>
                          Open draft editor
                        </button>
                      )}
                      {c.status === 'published' && c.published_slug && (
                        <a href={`/news/${c.published_slug}`} className="loro-nr-btn success">
                          Read published article →
                        </a>
                      )}
                    </div>

                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
