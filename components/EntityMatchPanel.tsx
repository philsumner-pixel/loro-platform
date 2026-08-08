'use client'

import { useEffect, useState, useCallback } from 'react'

// Entity resolution review.
//
// Following money across registers only works if the same company or person is
// recognised when each source spells them differently. Identifiers solve this
// where they exist; this is for everywhere they don't — which is every
// individual, and most procurement suppliers.
//
// Nothing merges automatically. A wrong merge asserts in published journalism
// that two real people are one, so every fuzzy match is a human decision.

interface Match {
  id: string
  entity_a: string
  entity_b: string
  similarity: number
  match_reason: string
  status: string
  decided_by: string | null
  decided_at: string | null
  evidence: {
    name_a?: string; name_b?: string
    company_number_a?: string | null; company_number_b?: string | null
    jurisdiction_a?: string | null; jurisdiction_b?: string | null
    events_a?: number; events_b?: number
  }
}

export default function EntityMatchPanel() {
  const [matches, setMatches] = useState<Match[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [status, setStatus] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  // Who is reviewing. Decisions were previously all attributed to the literal
  // string 'newsroom', so the audit trail recorded THAT a call was made but not
  // WHO made it — which is the part that matters if a merge is ever questioned.
  const [reviewer, setReviewer] = useState('')

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('loro_reviewer') : null
    if (saved) setReviewer(saved)
  }, [])

  function saveReviewer(v: string) {
    setReviewer(v)
    if (typeof window !== 'undefined') window.localStorage.setItem('loro_reviewer', v)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/entities/matches?status=${status}`)
      const d = await res.json()
      setMatches(d.matches ?? [])
      setCounts(d.counts ?? {})
    } finally { setLoading(false) }
  }, [status])

  useEffect(() => { load() }, [load])

  async function decide(m: Match, decision: 'confirmed' | 'rejected', keep?: string) {
    if (!reviewer.trim()) {
      alert('Add your name first — merges are recorded against the person who made the call.')
      return
    }
    setBusy(m.id)
    try {
      const res = await fetch('/api/entities/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: m.id, decision, keep_entity: keep,
          decided_by: reviewer.trim() || 'unattributed',
        }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setMatches(prev => prev.filter(x => x.id !== m.id))
      setCounts(c => ({
        ...c,
        pending: Math.max(0, (c.pending ?? 1) - 1),
        [decision]: (c[decision] ?? 0) + 1,
      }))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Decision failed')
    } finally { setBusy(null) }
  }

  // Merges link rather than destroy, so they can be reversed. Without this the
  // audit trail would record a mistake without offering any way to correct it.
  async function undo(m: Match) {
    if (!confirm('Separate these entities again? Events return to their original records.')) return
    setBusy(m.id)
    try {
      const res = await fetch('/api/entities/matches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: m.id, decided_by: reviewer.trim() || 'unattributed' }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Undo failed')
    } finally { setBusy(null) }
  }

  async function generate() {
    setBusy('generate')
    try {
      const res = await fetch('/api/entities/matches', { method: 'PUT' })
      const d = await res.json()
      alert(`Proposed ${d.company_candidates ?? 0} company and ${d.person_candidates ?? 0} person candidates.`)
      load()
    } finally { setBusy(null) }
  }

  return (
    <div className="loro-em">
      <div className="loro-em-head">
        <div>
          <h2>Entity resolution</h2>
          <p>
            The same company or person is written differently in every register. Confirmed
            matches are joined so events follow the entity across sources. Nothing merges
            automatically — a wrong merge would assert that two real people are one.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <input
            value={reviewer}
            onChange={e => saveReviewer(e.target.value)}
            placeholder="Your name"
            title="Recorded against every decision you make"
            style={{
              padding: '7px 11px', border: '1px solid var(--border)', fontSize: 12.5,
              fontFamily: 'Inter, sans-serif', outline: 'none', width: 130,
            }}
          />
          <button className="loro-nr-btn primary" onClick={generate} disabled={busy === 'generate'}>
            {busy === 'generate' ? 'Scanning…' : 'Find new candidates'}
          </button>
        </div>
      </div>

      <div className="loro-em-tabs">
        {(['pending', 'confirmed', 'rejected'] as const).map(s => (
          <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
            {s[0].toUpperCase() + s.slice(1)}
            <span className="n">{counts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loro-nr-empty">Loading…</div>
      ) : matches.length === 0 ? (
        <div className="loro-nr-empty">
          {status === 'pending'
            ? 'No candidates awaiting review. Use “Find new candidates” after ingesting new sources.'
            : `Nothing ${status}.`}
        </div>
      ) : (
        <div className="loro-em-list">
          {matches.map(m => {
            const e = m.evidence ?? {}
            return (
              <div key={m.id} className="loro-em-row">
                <div className="loro-em-pair">
                  <div className="side">
                    <div className="nm">{e.name_a}</div>
                    <div className="sub">
                      {e.company_number_a ? `Company ${e.company_number_a}` : 'No identifier'}
                      {e.jurisdiction_a ? ` · ${e.jurisdiction_a}` : ''}
                      {typeof e.events_a === 'number' ? ` · ${e.events_a} events` : ''}
                    </div>
                  </div>
                  <div className="mid">
                    <span className="sim">{Math.round(m.similarity * 100)}%</span>
                    <span className="why">{m.match_reason}</span>
                  </div>
                  <div className="side">
                    <div className="nm">{e.name_b}</div>
                    <div className="sub">
                      {e.company_number_b ? `Company ${e.company_number_b}` : 'No identifier'}
                      {e.jurisdiction_b ? ` · ${e.jurisdiction_b}` : ''}
                      {typeof e.events_b === 'number' ? ` · ${e.events_b} events` : ''}
                    </div>
                  </div>
                </div>

                {status === 'pending' && (
                  <div className="loro-em-actions">
                    <button className="loro-nr-btn success" disabled={busy === m.id}
                      onClick={() => decide(m, 'confirmed')}>Same entity — merge</button>
                    <button className="loro-nr-btn" disabled={busy === m.id}
                      title="Keep the left-hand record as the surviving entity"
                      onClick={() => decide(m, 'confirmed', m.entity_a)}>Merge, keep left</button>
                    <button className="loro-nr-btn" disabled={busy === m.id}
                      onClick={() => decide(m, 'confirmed', m.entity_b)}>Merge, keep right</button>
                    <button className="loro-nr-btn danger" disabled={busy === m.id}
                      onClick={() => decide(m, 'rejected')}>Different — never ask again</button>
                  </div>
                )}
                {status !== 'pending' && (
                  <div className="loro-em-decided">
                    <strong>{m.status === 'confirmed' ? 'Merged' : 'Kept separate'}</strong>
                    {' by '}{m.decided_by ?? 'unattributed'}
                    {m.decided_at && ` · ${new Date(m.decided_at).toLocaleString('en-GB', {
                      day: 'numeric', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit' })}`}
                    {m.status === 'confirmed' && (
                      <button className="loro-nr-btn" style={{ marginLeft: 10, fontSize: 11, padding: '4px 9px' }}
                        onClick={() => undo(m)} disabled={busy === m.id}>Undo merge</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
