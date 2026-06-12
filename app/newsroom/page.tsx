'use client'

import { useState, useEffect, useCallback } from 'react'
import type { LoroVideo, LoroVideoScript } from '@/lib/loro-video'

interface EvidencePacket {
  timeline?: Array<{ date: string; event: string }>
  pattern_code?: string
  score_breakdown?: {
    base?: number; eventBonus?: number; sourceBonus?: number
    crossJurisdictionBonus?: number; entityTypeBonus?: number
    temporalBonus?: number; total?: number
  }
  [key: string]: unknown
}

interface CoverageLink {
  publication: string
  headline: string
  url: string | null
  published_at: string | null
  similarity_score: number | null
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
  coverage_summary: string | null
  angle_votes_up: number
  angle_votes_down: number
  ai_angle_generated: boolean
  status: string
  assigned_to: string | null
  published_slug: string | null
  evidence_packet: EvidencePacket
  detected_at: string
  coverage_links: CoverageLink[]
}

interface DraftState {
  candidateId: string; headline: string
  standfirst: string; body: string; category: string
}

interface SignalDigest {
  id: string
  entity_name: string
  trigger_type: string
  score_before: number | null
  score_after: number | null
  score_delta: number | null
  trigger_summary: string
  generated_story: string | null
  status: string
  triggered_at: string
  generated_at: string | null
  social_linkedin: string | null
  social_twitter: string | null
  social_generated_at: string | null
}

interface VideoSource {
  id: string
  entity_name: string
  trigger_type: string
  score_delta: number | null
  triggered_at: string
  digest_status: string
  trigger_summary: string | null
  has_video: boolean
}

const TABS = [
  { key: 'new,shortlisted', label: 'Inbox', statuses: ['new','shortlisted'] },
  { key: 'in_draft',        label: 'In draft', statuses: ['in_draft'] },
  { key: 'published',       label: 'Published', statuses: ['published'] },
  { key: 'signal_digest',   label: 'Signal Digest', statuses: [] },
  { key: 'video',           label: 'Video', statuses: [] },
]

const TRIGGER_LABELS: Record<string, string> = {
  score_drop: 'Score drop', score_rise: 'Score rise',
  pdmr: 'PDMR filing', alert: 'Alert', sentiment_spike: 'Sentiment', news_spike: 'News spike',
}

const COLUMNS = [
  {
    key: 'novel', label: 'Novel', sub: 'Nobody has this — publish now',
    filter: (c: Candidate) =>
      c.editorial_opportunity === 'exclusive' ||
      (c.novelty_status === 'novel' && !c.editorial_opportunity),
  },
  {
    key: 'angle', label: 'Angle play', sub: 'Covered — but not this way',
    filter: (c: Candidate) =>
      c.editorial_opportunity === 'angle_play' ||
      (c.novelty_status === 'widely_covered' && !c.editorial_opportunity),
  },
  {
    key: 'depth', label: 'Depth play', sub: 'Go deeper than what\'s out there',
    filter: (c: Candidate) =>
      c.editorial_opportunity === 'depth_play' ||
      c.editorial_opportunity === 'context_only' ||
      c.editorial_opportunity === 'watch' ||
      (!['exclusive','angle_play','depth_play','context_only','watch'].includes(c.editorial_opportunity ?? '') &&
       !['novel','widely_covered'].includes(c.novelty_status)),
  },
]

const UP_REASONS = [
  'Specific regulatory provision not covered',
  'Timing pattern is genuinely novel',
  'Cross-jurisdictional angle nobody has',
  'Pre-announcement signal is strong',
  'Loro has proprietary data on this',
]
const DOWN_REASONS = [
  'Company covered, not the specific event',
  'Already widely reported elsewhere',
  'Not payments-relevant enough',
  'Angle too speculative',
  'Story doesn\'t hold without more data',
]

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (d > 0) return `${d}d ago`
  if (h > 0) return `${h}h ago`
  return 'Just now'
}
function scoreClass(s: number | null) { return !s ? 'low' : s >= 8 ? 'high' : s >= 6 ? 'mid' : 'low' }
function noveltyClass(s: string) { return s==='novel'?'novel':s==='lightly_covered'?'lightly':s==='widely_covered'?'widely':'unchecked' }
function noveltyLabel(s: string) { return s==='novel'?'Novel':s==='lightly_covered'?'Lightly covered':s==='widely_covered'?'Widely covered':'Unchecked' }
function oppLabel(s: string | null) { return {exclusive:'Exclusive',depth_play:'Depth play',angle_play:'Angle play',context_only:'Context only',watch:'Watching'}[s??'']??'' }

// ── Detail panel ─────────────────────────────────────────────────────
function DetailPanel({ c, onVoteAngle, onUpdateStatus, onOpenDraft, updating }: {
  c: Candidate
  onVoteAngle: (id: string, vote: 'up'|'down') => void
  onUpdateStatus: (id: string, status: string, extra?: Record<string,string>) => void
  onOpenDraft: (c: Candidate) => void
  updating: string | null
}) {
  const [voteDir, setVoteDir] = useState<'up'|'down'|null>(null)
  const [voteNote, setVoteNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [generatingBrief, setGeneratingBrief] = useState(false)
  const [briefError, setBriefError] = useState<string|null>(null)
  const bd = c.evidence_packet?.score_breakdown

  async function generateBrief() {
    setGeneratingBrief(true)
    setBriefError(null)
    try {
      const res = await fetch('/api/newsroom/generate-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_id: c.id }),
      })
      const data = await res.json()
      if (data.error) setBriefError(data.error)
      else onUpdateStatus(c.id, c.status)  // reload
    } catch {
      setBriefError('Generation failed — check ANTHROPIC_API_KEY is set in Vercel')
    } finally {
      setGeneratingBrief(false)
    }
  }

  async function submitVote() {
    if (!voteDir) return
    setSaving(true)
    await fetch('/api/newsroom/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_id: c.id, vote: voteDir, note: voteNote || null }),
    })
    setVoteDir(null)
    setVoteNote('')
    setSaving(false)
    onVoteAngle(c.id, voteDir)
  }

  return (
    <div className="loro-nr-detail">
      <div className="loro-nr-detail-headline">{c.headline}</div>
      {c.standfirst && <div className="loro-nr-detail-standfirst">{c.standfirst}</div>}

      <div className="loro-nr-detail-grid">
        {/* Evidence timeline */}
        <div>
          <div className="loro-nr-detail-section-title">Evidence timeline</div>
          <div className="loro-nr-timeline">
            {(c.evidence_packet?.timeline ?? []).map((item,i) => (
              <div key={i} className="loro-nr-tl-item">
                <span className="loro-nr-tl-date">{item.date}</span>
                <span className="loro-nr-tl-event">{item.event}</span>
              </div>
            ))}
            {!c.evidence_packet?.timeline && <span style={{fontSize:13,color:'var(--ink5)'}}>No timeline data</span>}
          </div>
        </div>

        {/* Signal data */}
        <div>
          <div className="loro-nr-detail-section-title">Signal data</div>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {c.anomaly_score && (
              <div>
                <span style={{fontSize:11,color:'var(--ink5)',letterSpacing:'0.06em',textTransform:'uppercase'}}>Anomaly score</span>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:28,fontWeight:500,color:'var(--ink)',marginTop:2}}>
                  {c.anomaly_score.toFixed(1)}<span style={{fontSize:14,color:'var(--ink5)'}}>/10</span>
                </div>
                {bd && (
                  <div style={{fontSize:11,color:'var(--ink5)',lineHeight:1.9,marginTop:4}}>
                    {bd.base != null && <div>Base: {bd.base.toFixed(1)}</div>}
                    {(bd.eventBonus ?? 0) > 0 && <div>+ Events: +{(bd.eventBonus??0).toFixed(1)}</div>}
                    {(bd.sourceBonus ?? 0) > 0 && <div>+ Sources: +{(bd.sourceBonus??0).toFixed(1)}</div>}
                    {(bd.crossJurisdictionBonus ?? 0) > 0 && <div>+ Cross-jurisdiction: +{(bd.crossJurisdictionBonus??0).toFixed(1)}</div>}
                    {(bd.temporalBonus ?? 0) > 0 && <div>+ Temporal compression: +{(bd.temporalBonus??0).toFixed(1)}</div>}
                  </div>
                )}
              </div>
            )}
            <div>
              <span style={{fontSize:11,color:'var(--ink5)',letterSpacing:'0.06em',textTransform:'uppercase'}}>Novelty</span>
              <div style={{marginTop:4}}>
                <span className={`loro-nr-novelty ${noveltyClass(c.novelty_status)}`}>{noveltyLabel(c.novelty_status)}</span>
              </div>
              {c.novelty_note && <div style={{fontSize:12,color:'var(--ink4)',lineHeight:1.6,marginTop:8}}>{c.novelty_note}</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Coverage links */}
      {c.coverage_links?.length > 0 && (
        <div style={{marginBottom:24}}>
          <div className="loro-nr-detail-section-title">
            Coverage found — {c.coverage_links.length} article{c.coverage_links.length>1?'s':''}
          </div>
          <div className="loro-nr-coverage-list">
            {c.coverage_links.map((link,i) => (
              <div key={i} className="loro-nr-coverage-item">
                <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:12}}>
                  <div>
                    <span className="loro-nr-coverage-pub">{link.publication}</span>
                    {link.similarity_score && (
                      <span style={{fontSize:9,color:'var(--ink5)',marginLeft:8,fontFamily:"'IBM Plex Mono',monospace"}}>
                        sim {(link.similarity_score*100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  {link.published_at && (
                    <span style={{fontSize:10,color:'var(--ink5)',whiteSpace:'nowrap'}}>
                      {new Date(link.published_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}
                    </span>
                  )}
                </div>
                {link.url
                  ? <a href={link.url} target="_blank" rel="noopener noreferrer"
                      className="loro-nr-coverage-angle" style={{color:'var(--blue-mid)',textDecoration:'none'}}>
                      {link.headline} →
                    </a>
                  : <div className="loro-nr-coverage-angle">{link.headline}</div>
                }
              </div>
            ))}
          </div>
          <div style={{fontSize:11,color:'var(--ink5)',marginTop:8,fontStyle:'italic'}}>
            Similarity % shows how closely these articles match the signal — not whether the specific angle is covered.
          </div>
        </div>
      )}

      {/* AI angle + voting */}
      {c.loro_angle_hypothesis && (
        <div style={{marginBottom:24}}>
          <div className="loro-nr-detail-section-title" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <span>{c.ai_angle_generated ? 'Engine angle suggestion' : 'Editorial angle'}</span>
            {!voteDir && (
              <div style={{display:'flex',gap:6}}>
                <button onClick={() => setVoteDir('up')}
                  style={{background:'none',border:'1px solid var(--border)',padding:'2px 10px',cursor:'pointer',fontSize:13,borderRadius:4,color:c.angle_votes_up>0?'#1E6B3A':'var(--ink5)'}}>
                  🔥 {c.angle_votes_up > 0 ? c.angle_votes_up : ''}
                </button>
                <button onClick={() => setVoteDir('down')}
                  style={{background:'none',border:'1px solid var(--border)',padding:'2px 10px',cursor:'pointer',fontSize:13,borderRadius:4,color:c.angle_votes_down>0?'#B33A1A':'var(--ink5)'}}>
                  👎 {c.angle_votes_down > 0 ? c.angle_votes_down : ''}
                </button>
              </div>
            )}
          </div>
          <div className="loro-nr-angle-box">
            <div className="loro-nr-angle-text">{c.loro_angle_hypothesis}</div>
          </div>

          {/* Reason capture panel */}
          {voteDir && (
            <div style={{marginTop:12,background:'var(--paper2)',border:'1px solid var(--border)',padding:'14px 16px'}}>
              <div style={{fontSize:10,fontWeight:500,letterSpacing:'0.1em',textTransform:'uppercase',color:voteDir==='up'?'#1E6B3A':'#B33A1A',marginBottom:10}}>
                {voteDir==='up' ? '🔥 Strong angle — tell us why' : '👎 Weak angle — tell us why'}
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
                {(voteDir==='up' ? UP_REASONS : DOWN_REASONS).map(r => (
                  <button key={r} onClick={() => setVoteNote(voteNote===r?'':r)}
                    style={{fontSize:11,padding:'4px 10px',cursor:'pointer',borderRadius:20,fontFamily:'var(--font-sans)',
                      border:`1px solid ${voteNote===r?(voteDir==='up'?'#1E6B3A':'#B33A1A'):'var(--border)'}`,
                      background:voteNote===r?(voteDir==='up'?'#EEFAF2':'#FEF2EE'):'var(--paper)',
                      color:voteNote===r?(voteDir==='up'?'#1E6B3A':'#B33A1A'):'var(--ink4)'}}>
                    {r}
                  </button>
                ))}
              </div>
              <textarea placeholder="Add more detail (optional)…"
                value={voteNote.length>40?voteNote:''} onChange={e => setVoteNote(e.target.value)}
                rows={2} style={{width:'100%',padding:'8px 10px',border:'1px solid var(--border)',fontSize:12,color:'var(--ink)',background:'var(--paper)',outline:'none',resize:'none',fontFamily:'var(--font-sans)',marginBottom:10}}/>
              <div style={{display:'flex',gap:8}}>
                <button className="loro-nr-btn primary" onClick={submitVote} disabled={saving} style={{fontSize:11}}>
                  {saving?'Saving…':'Submit →'}
                </button>
                <button className="loro-nr-btn" onClick={() => {setVoteDir(null);setVoteNote('')}} style={{fontSize:11}}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {!voteDir && <div style={{fontSize:10,color:'var(--ink5)',marginTop:6}}>Vote to calibrate — your decisions train the engine</div>}
        </div>
      )}

      {/* AI brief */}
      <div className="loro-nr-detail-section-title" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span>AI brief</span>
        {!c.ai_brief && (
          <button className="loro-nr-btn primary" style={{fontSize:10,padding:'3px 12px'}}
            onClick={generateBrief} disabled={generatingBrief}>
            {generatingBrief ? 'Generating…' : '✦ Generate brief'}
          </button>
        )}
        {c.ai_brief && (
          <button className="loro-nr-btn" style={{fontSize:10,padding:'3px 12px'}}
            onClick={generateBrief} disabled={generatingBrief}>
            {generatingBrief ? 'Regenerating…' : '↻ Regenerate'}
          </button>
        )}
      </div>
      {briefError && (
        <div style={{fontSize:12,color:'#B33A1A',padding:'8px 12px',background:'#FEF2EE',marginBottom:10}}>
          {briefError}
        </div>
      )}
      <div className="loro-nr-brief">
        {c.ai_brief ? (
          <div style={{whiteSpace:'pre-wrap',fontSize:13,lineHeight:1.75,color:'var(--ink3)',fontFamily:"'Inter',sans-serif"}}>{c.ai_brief}</div>
        ) : (
          <span className="loro-nr-brief-placeholder">
            {generatingBrief
              ? 'Generating first draft with Claude Sonnet — usually takes 15–20 seconds…'
              : 'Click "Generate brief" to produce a 75% first draft from the signal evidence. Requires ANTHROPIC_API_KEY in Vercel.'}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="loro-nr-detail-actions" style={{marginTop:20}}>
        {c.status === 'new' && (
          <>
            <button className="loro-nr-btn primary" disabled={updating===c.id} onClick={() => onUpdateStatus(c.id,'shortlisted')}>Shortlist →</button>
            <button className="loro-nr-btn danger" disabled={updating===c.id} onClick={() => onUpdateStatus(c.id,'discarded',{discard_reason:'Not relevant'})}>Discard</button>
          </>
        )}
        {c.status === 'shortlisted' && (
          <>
            <button className="loro-nr-btn success" disabled={updating===c.id} onClick={() => { onUpdateStatus(c.id,'in_draft'); onOpenDraft(c) }}>Take to draft</button>
            <button className="loro-nr-btn danger" disabled={updating===c.id} onClick={() => onUpdateStatus(c.id,'discarded',{discard_reason:'Deprioritised'})}>Discard</button>
          </>
        )}
        {c.status === 'in_draft' && (
          <button className="loro-nr-btn primary" onClick={() => onOpenDraft(c)}>Open draft editor</button>
        )}
        {c.status === 'published' && c.published_slug && (
          <a href={`/news/${c.published_slug}`} className="loro-nr-btn success">Read published article →</a>
        )}
        
      </div>
    </div>
  )
}

// ── Score tooltip ─────────────────────────────────────────────────────
function ScoreBadge({ c }: { c: Candidate }) {
  if (!c.anomaly_score) return null
  const bd = c.evidence_packet?.score_breakdown
  const pattern = (c.evidence_packet?.pattern_code as string ?? '').replace(/_/g,' ')
  return (
    <div className="loro-nr-score-wrap" onClick={e => e.stopPropagation()}>
      <span className={`loro-nr-score ${scoreClass(c.anomaly_score)}`}>{c.anomaly_score.toFixed(1)}</span>
      <div className="loro-nr-score-tooltip">
        <div className="loro-nr-tooltip-title">Anomaly score / 10</div>
        {bd ? (
          <>
            {bd.base != null && <div className="loro-nr-tooltip-row"><span>Base {pattern ? `(${pattern})` : ''}</span><span>{bd.base.toFixed(1)}</span></div>}
            {(bd.eventBonus??0)>0 && <div className="loro-nr-tooltip-row"><span>Event count bonus</span><span>+{(bd.eventBonus??0).toFixed(1)}</span></div>}
            {(bd.sourceBonus??0)>0 && <div className="loro-nr-tooltip-row"><span>Multi-source bonus</span><span>+{(bd.sourceBonus??0).toFixed(1)}</span></div>}
            {(bd.crossJurisdictionBonus??0)>0 && <div className="loro-nr-tooltip-row"><span>Cross-jurisdiction (UK+EU+US)</span><span>+{(bd.crossJurisdictionBonus??0).toFixed(1)}</span></div>}
            {(bd.entityTypeBonus??0)>0 && <div className="loro-nr-tooltip-row"><span>Entity type (EMI/bank/listed)</span><span>+{(bd.entityTypeBonus??0).toFixed(1)}</span></div>}
            {(bd.temporalBonus??0)>0 && <div className="loro-nr-tooltip-row"><span>Temporal compression (&lt;72hr)</span><span>+{(bd.temporalBonus??0).toFixed(1)}</span></div>}
            <div className="loro-nr-tooltip-row loro-nr-tooltip-total"><span>Total</span><span>{c.anomaly_score.toFixed(1)}/10</span></div>
          </>
        ) : (
          <>
            <div className="loro-nr-tooltip-row"><span>Pattern base signal</span><span>varies</span></div>
            <div className="loro-nr-tooltip-row"><span>Event count</span><span>+bonus</span></div>
            <div className="loro-nr-tooltip-row"><span>Cross-jurisdiction (UK+EU+US)</span><span>+1.5 max</span></div>
            <div className="loro-nr-tooltip-row"><span>Entity type (EMI/bank/listed)</span><span>+2.0 max</span></div>
            <div className="loro-nr-tooltip-row"><span>Temporal compression</span><span>+0.5 max</span></div>
            <div className="loro-nr-tooltip-row loro-nr-tooltip-total"><span>Maximum possible</span><span>10.0</span></div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────
export default function NewsroomPage() {
  const [activeTab, setActiveTab] = useState(TABS[0])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Candidate | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)
  const [digests, setDigests] = useState<SignalDigest[]>([])
  const [selectedDigest, setSelectedDigest] = useState<SignalDigest | null>(null)
  const [generatingDigest, setGeneratingDigest] = useState<string | null>(null)
  const [generatingSocial, setGeneratingSocial] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [videos, setVideos] = useState<LoroVideo[]>([])
  const [videoSources, setVideoSources] = useState<VideoSource[]>([])
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null)
  const [draftingScript, setDraftingScript] = useState<string | null>(null)
  const [scriptEdit, setScriptEdit] = useState<Record<string, LoroVideoScript>>({})
  const [savingScript, setSavingScript] = useState<string | null>(null)
  const [showArchive, setShowArchive] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setSelected(null)
    try {
      const res = await fetch(`/api/newsroom?status=${activeTab.key}`)
      const data = await res.json()
      setCandidates(data.candidates ?? [])
    } catch { setCandidates([]) }
    finally { setLoading(false) }
  }, [activeTab.key])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (activeTab.key === 'signal_digest') {
      fetch('/api/newsroom/generate-digest')
        .then(r => r.json())
        .then(d => setDigests(d.digests ?? []))
        .catch(() => {})
    }
  }, [activeTab.key])

  useEffect(() => {
    if (activeTab.key === 'video') {
      fetch('/api/newsroom/videos')
        .then(r => r.json())
        .then(d => { setVideos(d.videos ?? []); setVideoSources(d.sources ?? []) })
        .catch(() => {})
    }
  }, [activeTab.key])

  async function generateDigest(id: string) {
    setGeneratingDigest(id)
    try {
      const res = await fetch('/api/newsroom/generate-digest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digest_id: id }),
      })
      const data = await res.json()
      if (data.story) {
        setDigests(prev => prev.map(d => d.id === id ? { ...d, generated_story: data.story } : d))
        setSelectedDigest(prev => prev?.id === id ? { ...prev, generated_story: data.story } : prev)
      }
    } finally { setGeneratingDigest(null) }
  }

  async function updateDigestStatus(id: string, status: string) {
    await fetch('/api/newsroom/generate-digest', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ digest_id: id, status }),
    })
    setDigests(prev => prev.map(d => d.id === id ? { ...d, status } : d))
    if (selectedDigest?.id === id) setSelectedDigest(prev => prev ? { ...prev, status } : null)
  }

  async function generateSocial(id: string) {
    setGeneratingSocial(id)
    try {
      const res = await fetch('/api/newsroom/generate-social', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digest_id: id }),
      })
      const data = await res.json()
      if (data.linkedin) {
        setDigests(prev => prev.map(d => d.id === id
          ? { ...d, social_linkedin: data.linkedin, social_twitter: data.twitter }
          : d))
        setSelectedDigest(prev => prev?.id === id
          ? { ...prev, social_linkedin: data.linkedin, social_twitter: data.twitter }
          : prev)
      }
    } finally { setGeneratingSocial(null) }
  }

  async function draftVideoScript(digestId: string) {
    setDraftingScript(digestId)
    try {
      const res = await fetch('/api/newsroom/generate-video-script', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digest_id: digestId }),
      })
      const data = await res.json()
      if (data.video) {
        setVideos(prev => [data.video, ...prev.filter(v => v.id !== data.video.id)])
        setVideoSources(prev => prev.map(s => s.id === digestId ? { ...s, has_video: true } : s))
        setSelectedVideo(data.video.id)
      }
    } finally { setDraftingScript(null) }
  }

  function editScriptField(video: LoroVideo, field: keyof LoroVideoScript, value: string) {
    const base = scriptEdit[video.id] ?? video.script
    setScriptEdit(prev => ({ ...prev, [video.id]: { ...base, [field]: value } }))
  }

  async function saveVideoScript(video: LoroVideo) {
    const edited = scriptEdit[video.id] ?? video.script
    setSavingScript(video.id)
    try {
      const res = await fetch('/api/newsroom/videos', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: video.id, script: edited, status: 'script_ready' }),
      })
      const data = await res.json()
      if (data.video) {
        setVideos(prev => prev.map(v => v.id === video.id ? data.video : v))
        setScriptEdit(prev => { const n = { ...prev }; delete n[video.id]; return n })
      }
    } finally { setSavingScript(null) }
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    })
  }

  async function updateStatus(id: string, status: string, extra: Record<string,string> = {}) {
    setUpdating(id)
    try {
      await fetch('/api/newsroom', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, ...extra }),
      })
      await load()
    } finally { setUpdating(null) }
  }

  function openDraft(c: Candidate) {
    setDraft({
      candidateId: c.id, headline: c.headline,
      standfirst: c.standfirst ?? '',
      body: c.ai_brief ? `<p>${c.ai_brief}</p>` : `<p>${c.standfirst ?? ''}</p>\n<p>[Write your article here]</p>`,
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
          candidate_id: draft.candidateId, headline: draft.headline,
          standfirst: draft.standfirst, body_html: draft.body,
          category: draft.category, publication_tier: 'section',
        }),
      })
      const data = await res.json()
      if (data.slug) { setPublishedUrl(data.url); setDraft(null); await load() }
    } finally { setPublishing(false) }
  }

  const inboxCounts = { novel: candidates.filter(COLUMNS[0].filter).length, angle: candidates.filter(COLUMNS[1].filter).length, depth: candidates.filter(COLUMNS[2].filter).length }

  const DAY_MS = 86400000
  function isNewSignal(iso: string) { return Date.now() - new Date(iso).getTime() < DAY_MS }
  function isStaleSignal(iso: string) { return Date.now() - new Date(iso).getTime() > 7 * DAY_MS }

  const activeSignalSources = videoSources.filter(s => !s.has_video && !isStaleSignal(s.triggered_at))
  const archivedSignalSources = videoSources.filter(s => !s.has_video && isStaleSignal(s.triggered_at))

  function renderSourceRow(s: VideoSource) {
    return (
      <div key={s.id} style={{background:'var(--paper)',padding:'12px 16px',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
        <div style={{minWidth:0,flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:5,flexWrap:'wrap'}}>
            {isNewSignal(s.triggered_at) && (
              <span style={{fontSize:8,fontWeight:700,letterSpacing:'0.12em',padding:'2px 6px',background:'var(--red-data)',color:'#fff'}}>NEW</span>
            )}
            <span style={{fontSize:9,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',padding:'2px 8px',background:'var(--blue)',color:'#fff'}}>
              {TRIGGER_LABELS[s.trigger_type] ?? s.trigger_type}
            </span>
            <span style={{fontSize:13,fontWeight:600,color:'var(--ink)'}}>{s.entity_name}</span>
            {s.score_delta != null && (
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:600,color: s.score_delta < 0 ? 'var(--red-data)' : 'var(--green)'}}>
                {s.score_delta > 0 ? '+' : ''}{s.score_delta.toFixed(1)} pts
              </span>
            )}
            <span style={{fontSize:10,color:'var(--ink5)'}}>{timeAgo(s.triggered_at)}</span>
          </div>
          {s.trigger_summary && (
            <div style={{fontSize:12,color:'var(--ink4)',lineHeight:1.5}}>{s.trigger_summary}</div>
          )}
        </div>
        <button className="loro-nr-btn primary" style={{fontSize:10,padding:'4px 12px',whiteSpace:'nowrap',flexShrink:0}}
          onClick={() => draftVideoScript(s.id)} disabled={draftingScript === s.id}>
          {draftingScript === s.id ? 'Drafting...' : '❖ Draft video script'}
        </button>
      </div>
    )
  }

  return (
    <div className="loro-newsroom">
      {/* Header */}
      <div className="loro-nr-header">
        <div className="loro-nr-header-inner">
          <div style={{display:'flex',alignItems:'baseline'}}>
            <span className="loro-nr-wordmark">Loro</span>
            <span className="loro-nr-badge">Newsroom</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:20}}>
            <a href="/" style={{fontSize:12,color:'rgba(255,255,255,0.4)',letterSpacing:'0.04em'}}>← View site</a>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="loro-nr-tabs">
        <div className="loro-nr-tabs-inner">
          {TABS.map(tab => (
            <button key={tab.key} className={`loro-nr-tab${activeTab.key===tab.key?' active':''}`}
              onClick={() => setActiveTab(tab)}>
              {tab.label}
              <span className="loro-nr-tab-count">
                {tab.key === 'new,shortlisted'
                  ? Object.values(inboxCounts).reduce((a,b)=>a+b,0)
                  : tab.key === 'signal_digest'
                  ? digests.filter(d => d.status === 'pending').length
                  : tab.key === 'video'
                  ? videos.filter(v => v.status === 'suggested' || v.status === 'script_ready').length
                  : candidates.filter(c=>tab.statuses.includes(c.status)).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="loro-nr-body">
        {/* Draft editor */}
        {draft && (
          <div style={{background:'var(--paper)',border:'1px solid var(--border)',borderLeft:'3px solid var(--blue)',padding:'28px 32px',marginBottom:24}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
              <div className="loro-nr-detail-section-title" style={{margin:0}}>Draft editor</div>
              <button className="loro-nr-btn" onClick={() => setDraft(null)}>Discard draft</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div>
                <label style={{fontSize:10,fontWeight:500,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink5)',display:'block',marginBottom:6}}>Headline</label>
                <input value={draft.headline} onChange={e => setDraft(d=>d?{...d,headline:e.target.value}:null)}
                  style={{width:'100%',padding:'10px 14px',border:'1px solid var(--border)',fontFamily:"'Playfair Display',serif",fontSize:17,fontWeight:600,color:'var(--ink)',background:'var(--paper)',outline:'none'}}/>
              </div>
              <div>
                <label style={{fontSize:10,fontWeight:500,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink5)',display:'block',marginBottom:6}}>Standfirst</label>
                <textarea value={draft.standfirst} onChange={e => setDraft(d=>d?{...d,standfirst:e.target.value}:null)} rows={2}
                  style={{width:'100%',padding:'10px 14px',border:'1px solid var(--border)',fontFamily:"'Inter',sans-serif",fontSize:14,color:'var(--ink3)',background:'var(--paper)',outline:'none',resize:'vertical'}}/>
              </div>
              <div>
                <label style={{fontSize:10,fontWeight:500,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink5)',display:'block',marginBottom:6}}>Body (HTML — &lt;p&gt; tags)</label>
                <textarea value={draft.body} onChange={e => setDraft(d=>d?{...d,body:e.target.value}:null)} rows={14}
                  style={{width:'100%',padding:'12px 14px',border:'1px solid var(--border)',fontFamily:"'IBM Plex Mono',monospace",fontSize:12,color:'var(--ink)',background:'var(--paper2)',outline:'none',resize:'vertical',lineHeight:1.7}}/>
              </div>
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                <button className="loro-nr-btn success" style={{padding:'10px 28px',fontSize:13}}
                  disabled={publishing||!draft.headline||!draft.body} onClick={publishDraft}>
                  {publishing?'Publishing…':'Publish →'}
                </button>
                <span style={{fontSize:12,color:'var(--ink5)'}}>Goes live immediately at /news/[slug]</span>
              </div>
            </div>
          </div>
        )}

        {publishedUrl && (
          <div style={{background:'#EEFAF2',border:'1px solid #C2E8CF',padding:'14px 20px',marginBottom:24,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <span style={{fontSize:13,color:'#1E6B3A',fontWeight:500}}>Article published successfully</span>
            <a href={publishedUrl} style={{fontSize:13,color:'#1E6B3A',fontWeight:500}}>View live article →</a>
          </div>
        )}

        {loading && <div className="loro-nr-empty">Loading…</div>}

        {/* Inbox — three columns */}
        {!loading && activeTab.key === 'new,shortlisted' && (
          candidates.length === 0
            ? <div className="loro-nr-empty">No candidates in queue.</div>
            : (
              <div className="loro-nr-columns">
                {COLUMNS.map(col => {
                  const cols = candidates.filter(col.filter)
                  return (
                    <div key={col.key} className={`loro-nr-col ${col.key}`}>
                      <div className="loro-nr-col-hd">
                        <div className="loro-nr-col-hd-top">
                          <div className="loro-nr-col-title">{col.label}</div>
                          <span className="loro-nr-col-count">{cols.length}</span>
                        </div>
                        <div className="loro-nr-col-sub">{col.sub}</div>
                      </div>
                      {cols.length === 0
                        ? <div className="loro-nr-col-empty">None right now</div>
                        : cols.map(c => (
                          <div key={c.id}>
                            <div className={`loro-nr-card${selected?.id===c.id?' selected':''}`}
                              onClick={() => setSelected(selected?.id===c.id?null:c)}>
                              <div className="loro-nr-card-meta">
                                <span className="loro-nr-cat" style={{fontSize:9}}>{c.category}</span>
                                <ScoreBadge c={c} />
                                <span className={`loro-nr-novelty ${noveltyClass(c.novelty_status)}`}>{noveltyLabel(c.novelty_status)}</span>
                              </div>
                              <div className="loro-nr-card-headline">{c.headline}</div>
                              {c.standfirst && <div className="loro-nr-card-standfirst">{c.standfirst}</div>}
                              <div className="loro-nr-card-foot">
                                <span className="loro-nr-card-age">{timeAgo(c.detected_at)}</span>
                                <div className="loro-nr-card-actions" onClick={e=>e.stopPropagation()}>
                                  {c.status==='new' && <button className="loro-nr-btn primary" style={{fontSize:10,padding:'4px 10px'}} disabled={updating===c.id} onClick={() => updateStatus(c.id,'shortlisted')}>Shortlist</button>}
                                  {c.status==='shortlisted' && <button className="loro-nr-btn success" style={{fontSize:10,padding:'4px 10px'}} disabled={updating===c.id} onClick={() => {updateStatus(c.id,'in_draft');openDraft(c)}}>Draft</button>}
                                  <button className="loro-nr-btn danger" style={{fontSize:10,padding:'4px 10px'}} disabled={updating===c.id} onClick={() => updateStatus(c.id,'discarded',{discard_reason:'Dismissed'})}>✕</button>
                                </div>
                              </div>
                            </div>
                            {selected?.id===c.id && (
                              <DetailPanel c={c} onVoteAngle={() => load()} onUpdateStatus={updateStatus} onOpenDraft={openDraft} updating={updating}/>
                            )}
                          </div>
                        ))
                      }
                    </div>
                  )
                })}
              </div>
            )
        )}

        {/* Signal Digest tab */}
        {activeTab.key === 'signal_digest' && (
          <div>
            <div style={{marginBottom:20,padding:'14px 20px',background:'var(--paper2)',border:'1px solid var(--border)',borderLeft:'3px solid var(--blue)'}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--ink)',marginBottom:4}}>Signal Digest — data-led short stories</div>
              <div style={{fontSize:12,color:'var(--ink4)',lineHeight:1.6}}>
                Auto-detected signals from the scoring engine. Generate a 150-word digest story, check it, approve or discard. Fast-turnaround content for the site and newsletter.
              </div>
            </div>

            {digests.length === 0 && (
              <div className="loro-nr-empty">No signal digests yet — they auto-generate when significant score moves are detected.</div>
            )}

            <div style={{display:'flex',flexDirection:'column',gap:1,background:'var(--border)'}}>
              {digests.map(d => (
                <div key={d.id}>
                  <div
                    onClick={() => setSelectedDigest(selectedDigest?.id === d.id ? null : d)}
                    style={{
                      background: selectedDigest?.id === d.id ? 'var(--paper2)' : 'var(--paper)',
                      padding:'16px 20px', cursor:'pointer',
                      display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16
                    }}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                        <span style={{fontSize:9,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',
                          padding:'2px 8px',background:'var(--blue)',color:'#fff'}}>
                          {TRIGGER_LABELS[d.trigger_type] ?? d.trigger_type}
                        </span>
                        {d.score_delta != null && (
                          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:600,
                            color: d.score_delta < 0 ? 'var(--red-data)' : 'var(--green)'}}>
                            {d.score_delta > 0 ? '+' : ''}{d.score_delta.toFixed(1)} pts
                          </span>
                        )}
                        <span style={{fontSize:10,
                          padding:'2px 8px',border:'1px solid var(--border)',
                          background: d.status === 'approved' ? 'var(--green-bg)' : d.status === 'discarded' ? 'var(--red-bg)' : 'var(--paper2)',
                          color: d.status === 'approved' ? 'var(--green)' : d.status === 'discarded' ? 'var(--red-data)' : 'var(--ink5)'}}>
                          {d.status}
                        </span>
                      </div>
                      <div style={{fontSize:14,fontWeight:600,color:'var(--ink)',marginBottom:4,lineHeight:1.35}}>
                        {d.entity_name}
                      </div>
                      <div style={{fontSize:12,color:'var(--ink4)',lineHeight:1.5}}>{d.trigger_summary}</div>
                    </div>
                    <div style={{fontSize:10,color:'var(--ink5)',whiteSpace:'nowrap',flexShrink:0,marginTop:2}}>
                      {timeAgo(d.triggered_at)}
                    </div>
                  </div>

                  {selectedDigest?.id === d.id && (
                    <div style={{background:'var(--paper)',borderTop:'1px solid var(--border)',padding:'24px 20px'}}>

                      {/* Story */}
                      <div style={{marginBottom:20}}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                          <div style={{fontSize:10,fontWeight:600,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--ink5)'}}>
                            Digest story
                          </div>
                          <button className="loro-nr-btn primary" style={{fontSize:10,padding:'3px 12px'}}
                            onClick={() => generateDigest(d.id)}
                            disabled={generatingDigest === d.id}>
                            {generatingDigest === d.id ? 'Generating...' : d.generated_story ? '↻ Regenerate' : '❖ Generate story'}
                          </button>
                        </div>

                        {d.generated_story ? (
                          <div style={{background:'var(--paper2)',border:'1px solid var(--border)',padding:'20px 24px',
                            fontFamily:"'Inter',sans-serif",fontSize:13,lineHeight:1.8,color:'var(--ink3)',
                            whiteSpace:'pre-wrap'}}>
                            {d.generated_story}
                          </div>
                        ) : (
                          <div style={{padding:'20px 24px',background:'var(--paper2)',border:'1px solid var(--border)',
                            fontSize:13,color:'var(--ink5)',fontStyle:'italic'}}>
                            {generatingDigest === d.id
                              ? 'Generating with Claude Haiku — takes 5-10 seconds...'
                              : 'Click Generate story to produce a 150-word data-led digest from this signal.'}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      {d.status === 'pending' && d.generated_story && (
                        <div style={{display:'flex',gap:8}}>
                          <button className="loro-nr-btn success" style={{fontSize:11}}
                            onClick={() => updateDigestStatus(d.id, 'approved')}>
                            Approve for publication
                          </button>
                          <button className="loro-nr-btn danger" style={{fontSize:11}}
                            onClick={() => updateDigestStatus(d.id, 'discarded')}>
                            Discard
                          </button>
                        </div>
                      )}
                      {d.status === 'approved' && (
                        <div>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                            marginBottom:14,paddingTop:4}}>
                            <div style={{fontSize:12,color:'var(--green)',fontWeight:500}}>
                              &#10003; Approved
                            </div>
                            <button className="loro-nr-btn primary" style={{fontSize:10,padding:'3px 12px'}}
                              onClick={() => generateSocial(d.id)}
                              disabled={generatingSocial === d.id}>
                              {generatingSocial === d.id
                                ? 'Generating...'
                                : d.social_linkedin ? '↻ Regenerate social posts' : '❖ Generate social posts'}
                            </button>
                          </div>

                          {generatingSocial === d.id && (
                            <div style={{fontSize:12,color:'var(--ink5)',fontStyle:'italic',marginBottom:12}}>
                              Generating LinkedIn + Twitter/X posts with Claude Haiku...
                            </div>
                          )}

                          {d.social_linkedin && d.social_twitter && (
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,background:'var(--border)'}}>

                              {/* LinkedIn */}
                              <div style={{background:'var(--paper)',padding:'16px 18px'}}>
                                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                                  <div style={{fontSize:10,fontWeight:600,letterSpacing:'0.12em',
                                    textTransform:'uppercase',color:'var(--ink5)'}}>
                                    LinkedIn
                                  </div>
                                  <button
                                    onClick={() => copyToClipboard(d.social_linkedin!, `linkedin-${d.id}`)}
                                    style={{fontSize:10,padding:'3px 10px',cursor:'pointer',fontFamily:'inherit',
                                      border:'1px solid var(--border)',background: copiedField===`linkedin-${d.id}` ? 'var(--green-bg)' : 'var(--paper)',
                                      color: copiedField===`linkedin-${d.id}` ? 'var(--green)' : 'var(--ink4)'}}>
                                    {copiedField===`linkedin-${d.id}` ? 'Copied!' : 'Copy'}
                                  </button>
                                </div>
                                <div style={{fontSize:12,lineHeight:1.75,color:'var(--ink3)',
                                  whiteSpace:'pre-wrap',maxHeight:280,overflowY:'auto'}}>
                                  {d.social_linkedin}
                                </div>
                              </div>

                              {/* Twitter/X */}
                              <div style={{background:'var(--paper)',padding:'16px 18px'}}>
                                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                                  <div style={{fontSize:10,fontWeight:600,letterSpacing:'0.12em',
                                    textTransform:'uppercase',color:'var(--ink5)'}}>
                                    Twitter / X thread
                                  </div>
                                  <button
                                    onClick={() => copyToClipboard(d.social_twitter!, `twitter-${d.id}`)}
                                    style={{fontSize:10,padding:'3px 10px',cursor:'pointer',fontFamily:'inherit',
                                      border:'1px solid var(--border)',background: copiedField===`twitter-${d.id}` ? 'var(--green-bg)' : 'var(--paper)',
                                      color: copiedField===`twitter-${d.id}` ? 'var(--green)' : 'var(--ink4)'}}>
                                    {copiedField===`twitter-${d.id}` ? 'Copied!' : 'Copy'}
                                  </button>
                                </div>
                                <div style={{fontSize:12,lineHeight:1.75,color:'var(--ink3)',
                                  whiteSpace:'pre-wrap',maxHeight:280,overflowY:'auto'}}>
                                  {d.social_twitter}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab.key === 'video' && (
          <div>
            <div style={{marginBottom:20,padding:'14px 20px',background:'var(--paper2)',border:'1px solid var(--border)',borderLeft:'3px solid var(--blue)'}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--ink)',marginBottom:4}}>Video — 60-second single-reveal shorts</div>
              <div style={{fontSize:12,color:'var(--ink4)',lineHeight:1.6}}>
                Signals become a suggested script: hook, the data, what to watch. Edit the script, then generate the video. Each short carries the same Loro entry and exit cards.
              </div>
            </div>

            {/* Draft from a signal */}
            {activeSignalSources.length > 0 && (
              <div style={{marginBottom:24}}>
                <div style={{fontSize:10,fontWeight:600,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--ink5)',marginBottom:10}}>
                  Draft from a signal
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:1,background:'var(--border)'}}>
                  {activeSignalSources.map(renderSourceRow)}
                </div>
              </div>
            )}

            {/* Archive — signals with no action in over a week */}
            {archivedSignalSources.length > 0 && (
              <div style={{marginBottom:24}}>
                <div onClick={() => setShowArchive(a => !a)}
                  style={{fontSize:10,fontWeight:600,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--ink5)',marginBottom:10,cursor:'pointer',userSelect:'none'}}>
                  {showArchive ? '▾' : '▸'} Archive ({archivedSignalSources.length}) — no action in over a week
                </div>
                {showArchive && (
                  <div style={{display:'flex',flexDirection:'column',gap:1,background:'var(--border)',opacity:0.72}}>
                    {archivedSignalSources.map(renderSourceRow)}
                  </div>
                )}
              </div>
            )}

            {videos.length === 0 && (
              <div className="loro-nr-empty">No video drafts yet — draft one from a signal above.</div>
            )}

            {/* Video suggestion inbox */}
            <div style={{display:'flex',flexDirection:'column',gap:1,background:'var(--border)'}}>
              {videos.map(v => {
                const sc = scriptEdit[v.id] ?? v.script
                const dirty = !!scriptEdit[v.id]
                return (
                <div key={v.id}>
                  <div onClick={() => setSelectedVideo(selectedVideo === v.id ? null : v.id)}
                    style={{background: selectedVideo === v.id ? 'var(--paper2)' : 'var(--paper)',padding:'16px 20px',cursor:'pointer',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                        <span style={{fontSize:10,padding:'2px 8px',border:'1px solid var(--border)',
                          background: v.status === 'ready' || v.status === 'published' ? 'var(--green-bg)' : v.status === 'failed' ? 'var(--red-bg)' : 'var(--paper2)',
                          color: v.status === 'ready' || v.status === 'published' ? 'var(--green)' : v.status === 'failed' ? 'var(--red-data)' : 'var(--ink5)'}}>
                          {v.status}
                        </span>
                        <span style={{fontSize:14,fontWeight:600,color:'var(--ink)'}}>{v.entity_name}</span>
                      </div>
                      <div style={{fontSize:13,color:'var(--ink3)',lineHeight:1.5,fontStyle:'italic'}}>{sc?.hook}</div>
                    </div>
                    <div style={{fontSize:10,color:'var(--ink5)',whiteSpace:'nowrap',flexShrink:0,marginTop:2}}>
                      {timeAgo(v.created_at)}
                    </div>
                  </div>

                  {selectedVideo === v.id && sc && (
                    <div style={{background:'var(--paper)',borderTop:'1px solid var(--border)',padding:'24px 20px'}}>

                      {/* Data points */}
                      {Array.isArray(sc.data_points) && sc.data_points.length > 0 && (
                        <div style={{display:'flex',gap:1,background:'var(--border)',marginBottom:20,flexWrap:'wrap'}}>
                          {sc.data_points.map((dp, i) => (
                            <div key={i} style={{background:'var(--paper2)',padding:'10px 16px',flex:'1 1 120px'}}>
                              <div style={{fontSize:10,color:'var(--ink5)',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:4}}>{dp.label}</div>
                              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:20,fontWeight:500,color:'var(--ink)'}}>
                                {dp.value}{dp.delta && <span style={{fontSize:12,marginLeft:6,color: String(dp.delta).startsWith('-') ? 'var(--red-data)' : 'var(--green)'}}>{dp.delta}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Editable script */}
                      <div style={{display:'flex',flexDirection:'column',gap:14,marginBottom:20}}>
                        <div>
                          <label style={{fontSize:10,fontWeight:500,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink5)',display:'block',marginBottom:6}}>Hook</label>
                          <input value={sc.hook ?? ''} onChange={e => editScriptField(v, 'hook', e.target.value)}
                            style={{width:'100%',padding:'10px 14px',border:'1px solid var(--border)',fontFamily:"'Inter',sans-serif",fontSize:14,fontWeight:600,color:'var(--ink)',background:'var(--paper)',outline:'none'}}/>
                        </div>
                        <div>
                          <label style={{fontSize:10,fontWeight:500,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink5)',display:'block',marginBottom:6}}>Narration (voiceover)</label>
                          <textarea value={sc.narration ?? ''} onChange={e => editScriptField(v, 'narration', e.target.value)} rows={6}
                            style={{width:'100%',padding:'10px 14px',border:'1px solid var(--border)',fontFamily:"'Inter',sans-serif",fontSize:13,lineHeight:1.7,color:'var(--ink3)',background:'var(--paper)',outline:'none',resize:'vertical'}}/>
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                          <div>
                            <label style={{fontSize:10,fontWeight:500,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink5)',display:'block',marginBottom:6}}>Context</label>
                            <textarea value={sc.context ?? ''} onChange={e => editScriptField(v, 'context', e.target.value)} rows={2}
                              style={{width:'100%',padding:'10px 14px',border:'1px solid var(--border)',fontFamily:"'Inter',sans-serif",fontSize:13,lineHeight:1.6,color:'var(--ink3)',background:'var(--paper)',outline:'none',resize:'vertical'}}/>
                          </div>
                          <div>
                            <label style={{fontSize:10,fontWeight:500,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink5)',display:'block',marginBottom:6}}>What to watch</label>
                            <textarea value={sc.what_to_watch ?? ''} onChange={e => editScriptField(v, 'what_to_watch', e.target.value)} rows={2}
                              style={{width:'100%',padding:'10px 14px',border:'1px solid var(--border)',fontFamily:"'Inter',sans-serif",fontSize:13,lineHeight:1.6,color:'var(--ink3)',background:'var(--paper)',outline:'none',resize:'vertical'}}/>
                          </div>
                        </div>
                        <div>
                          <label style={{fontSize:10,fontWeight:500,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink5)',display:'block',marginBottom:6}}>Call to action</label>
                          <input value={sc.cta ?? ''} onChange={e => editScriptField(v, 'cta', e.target.value)}
                            style={{width:'100%',padding:'10px 14px',border:'1px solid var(--border)',fontFamily:"'Inter',sans-serif",fontSize:13,color:'var(--ink3)',background:'var(--paper)',outline:'none'}}/>
                        </div>
                        {Array.isArray(sc.broll_keywords) && sc.broll_keywords.length > 0 && (
                          <div>
                            <label style={{fontSize:10,fontWeight:500,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink5)',display:'block',marginBottom:6}}>B-roll keywords</label>
                            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                              {sc.broll_keywords.map((k, i) => (
                                <span key={i} style={{fontSize:11,padding:'3px 10px',border:'1px solid var(--border)',background:'var(--paper2)',color:'var(--ink4)'}}>{k}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Video preview (once render lane is live) */}
                      {v.video_url && (
                        <div style={{marginBottom:20}}>
                          <video src={v.video_url} controls style={{width:'100%',maxWidth:360,border:'1px solid var(--border)'}} />
                        </div>
                      )}

                      {/* Actions */}
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                        <button className="loro-nr-btn success" style={{fontSize:11}}
                          onClick={() => saveVideoScript(v)} disabled={savingScript === v.id}>
                          {savingScript === v.id ? 'Saving...' : dirty ? 'Save script' : 'Script saved'}
                        </button>
                        <button className="loro-nr-btn primary" style={{fontSize:11,opacity:0.5,cursor:'not-allowed'}}
                          disabled title="Connects once the render keys are added">
                          ▶ Generate video
                        </button>
                        <span style={{fontSize:11,color:'var(--ink5)'}}>
                          Voice: <strong style={{color:'var(--ink4)'}}>{v.voice_persona}</strong>
                          {' · '}render lane connects next
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )})}
            </div>
          </div>
        )}

        {/* Draft / Published — flat list */}
        {!loading && activeTab.key !== 'new,shortlisted' && activeTab.key !== 'signal_digest' && (
          candidates.length === 0
            ? <div className="loro-nr-empty">No candidates in this queue.</div>
            : (
              <div className="loro-nr-list">
                {candidates.map(c => (
                  <div key={c.id}>
                    <div className={`loro-nr-row${selected?.id===c.id?' selected':''}`}
                      onClick={() => setSelected(selected?.id===c.id?null:c)}>
                      <div className="loro-nr-row-left">
                        <div className="loro-nr-row-meta">
                          <span className="loro-nr-cat">{c.category}</span>
                          <ScoreBadge c={c} />
                          <span className={`loro-nr-novelty ${noveltyClass(c.novelty_status)}`}>{noveltyLabel(c.novelty_status)}</span>
                        </div>
                        <div className="loro-nr-headline">{c.headline}</div>
                        <div className="loro-nr-age">{timeAgo(c.detected_at)}</div>
                      </div>
                      <div className="loro-nr-row-actions" onClick={e=>e.stopPropagation()}>
                        {c.status==='published'&&c.published_slug && <a href={`/news/${c.published_slug}`} style={{fontSize:12,fontWeight:500,color:'var(--blue-mid)'}}>Read →</a>}
                        {c.status==='in_draft' && <button className="loro-nr-btn primary" onClick={()=>openDraft(c)}>Open draft</button>}
                      </div>
                    </div>
                    {selected?.id===c.id && (
                      <DetailPanel c={c} onVoteAngle={() => load()} onUpdateStatus={updateStatus} onOpenDraft={openDraft} updating={updating}/>
                    )}
                  </div>
                ))}
              </div>
            )
        )}
      </div>
    </div>
  )
}
