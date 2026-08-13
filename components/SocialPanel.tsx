'use client'

import { useEffect, useState, useCallback } from 'react'

// The social queue: generate from a published article, review, edit, approve,
// schedule. Nothing reaches a platform without passing through here — the
// human gate is the spine of the agreed architecture, not a bolt-on.

interface Post {
  id: string; platform: string; body: string
  link_url: string | null; hashtags: string[] | null
  status: string; article_slug: string | null
  scheduled_for: string | null; published_at: string | null
  approved_by: string | null; edited: boolean; error: string | null
}
interface Candidate {
  slug: string; headline: string; standfirst: string | null
  published_at: string; coverage_status: string | null
  source_citations: number; key_facts: number
  has_linkedin: boolean; has_x: boolean
}

const LIMIT = { linkedin: 3000, x: 280 }

export default function SocialPanel() {
  const [posts, setPosts] = useState<Post[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [status, setStatus] = useState('draft')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [approver, setApprover] = useState('')

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('loro_reviewer') : null
    if (saved) setApprover(saved)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/social/queue?status=${status}`)
      const d = await res.json()
      setPosts(d.posts ?? [])
      setCandidates(d.candidates ?? [])
      setCounts(d.counts ?? {})
    } finally { setLoading(false) }
  }, [status])

  useEffect(() => { load() }, [load])

  async function generate(slug: string) {
    setBusy(slug)
    try {
      const res = await fetch('/api/social/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setStatus('draft')
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Generation failed')
    } finally { setBusy(null) }
  }

  async function act(p: Post, action: string, scheduled?: string) {
    if ((action === 'approve' || action === 'schedule') && !approver.trim()) {
      alert('Add your name first — posts are recorded against the person who approved them.')
      return
    }
    setBusy(p.id)
    try {
      const res = await fetch('/api/social/queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: p.id, action,
          body: drafts[p.id] ?? undefined,
          scheduled_for: scheduled,
          approved_by: approver.trim() || undefined,
        }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    } finally { setBusy(null) }
  }

  return (
    <div className="loro-social">
      <div className="loro-social-head">
        <div>
          <h2>Social</h2>
          <p>
            Generate a post from a published story, review it, then approve or schedule.
            Nothing publishes without approval, and the post is recorded against whoever
            approved it.
          </p>
        </div>
        <input value={approver} placeholder="Your name"
          onChange={e => { setApprover(e.target.value); localStorage.setItem('loro_reviewer', e.target.value) }}
          style={{ padding: '7px 11px', border: '1px solid var(--border)', fontSize: 12.5, width: 140 }} />
      </div>

      {/* Articles worth posting */}
      <section className="loro-social-cands">
        <h3>Ready to promote</h3>
        {candidates.length === 0 ? (
          <div className="loro-nr-empty">No published articles yet.</div>
        ) : candidates.slice(0, 8).map(c => (
          <div key={c.slug} className="loro-social-cand">
            <div>
              <div className="hl">{c.headline}</div>
              <div className="meta">
                {c.coverage_status === 'exclusive' && <span className="excl">Only source</span>}
                {c.source_citations > 0 && <span>{c.source_citations} primary sources</span>}
                {c.key_facts > 0 && <span>{c.key_facts} key facts</span>}
                <span>{new Date(c.published_at).toLocaleDateString('en-GB')}</span>
              </div>
            </div>
            <button className="loro-nr-btn primary" disabled={busy === c.slug}
              onClick={() => generate(c.slug)}>
              {busy === c.slug ? 'Writing…'
                : (c.has_linkedin || c.has_x) ? 'Regenerate' : '✦ Write posts'}
            </button>
          </div>
        ))}
      </section>

      <div className="loro-social-tabs">
        {(['draft','approved','scheduled','published','rejected'] as const).map(s => (
          <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
            {s[0].toUpperCase() + s.slice(1)}<span className="n">{counts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      {loading ? <div className="loro-nr-empty">Loading…</div>
        : posts.length === 0 ? <div className="loro-nr-empty">Nothing {status}.</div>
        : posts.map(p => {
          const text = drafts[p.id] ?? p.body
          const limit = LIMIT[p.platform as keyof typeof LIMIT] ?? 3000
          const over = text.length > limit
          return (
            <div key={p.id} className="loro-social-post">
              <div className="top">
                <span className={`plat ${p.platform}`}>{p.platform === 'x' ? 'X' : 'LinkedIn'}</span>
                {p.edited && <span className="tag">Edited</span>}
                {p.error && <span className="tag err">{p.error}</span>}
                <span className={`count${over ? ' over' : ''}`}>{text.length}/{limit}</span>
              </div>

              {p.status === 'draft' ? (
                <textarea value={text} rows={p.platform === 'x' ? 3 : 7}
                  onChange={e => setDrafts(d => ({ ...d, [p.id]: e.target.value }))} />
              ) : (
                <p className="body">{p.body}</p>
              )}

              <div className="foot">
                {p.link_url && <a href={p.link_url} target="_blank" rel="noopener">{p.link_url}</a>}
                {(p.hashtags ?? []).length > 0 && (
                  <span className="tags">{(p.hashtags ?? []).map(h => `#${h.replace(/^#/, '')}`).join(' ')}</span>
                )}
              </div>

              {p.status === 'draft' && (
                <div className="actions">
                  <button className="loro-nr-btn success" disabled={busy === p.id || over}
                    onClick={() => act(p, 'approve')}>Approve</button>
                  <button className="loro-nr-btn" disabled={busy === p.id}
                    onClick={() => {
                      const when = prompt('Schedule for (YYYY-MM-DD HH:MM, your local time):')
                      if (when) act(p, 'schedule', new Date(when).toISOString())
                    }}>Schedule…</button>
                  <button className="loro-nr-btn" disabled={busy === p.id}
                    onClick={() => act(p, 'save')}>Save edit</button>
                  <button className="loro-nr-btn danger" disabled={busy === p.id}
                    onClick={() => act(p, 'reject')}>Reject</button>
                  <button className="loro-nr-btn" onClick={() => navigator.clipboard.writeText(
                    [text, p.link_url, (p.hashtags ?? []).map(h => `#${h.replace(/^#/, '')}`).join(' ')]
                      .filter(Boolean).join('\n\n'))}>Copy</button>
                </div>
              )}
              {p.status !== 'draft' && (
                <div className="decided">
                  {p.status}
                  {p.approved_by && ` by ${p.approved_by}`}
                  {p.scheduled_for && ` · for ${new Date(p.scheduled_for).toLocaleString('en-GB')}`}
                  {p.published_at && ` · ${new Date(p.published_at).toLocaleString('en-GB')}`}
                </div>
              )}
            </div>
          )
        })}
    </div>
  )
}
