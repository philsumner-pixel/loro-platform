'use client'

import { useRef, useState } from 'react'

// Lead image for an article: upload, preview, alt/caption/credit.
// Structured and stored on loro_articles rather than inside body_html, so it
// renders above the body, feeds the share card and lane listings, and can
// never collide with the in-article ad slot.

interface Patch {
  leadImageUrl?: string | null
  leadImageAlt?: string
  leadImageCaption?: string
  leadImageCredit?: string
}

export default function LeadImageField({
  url = null, alt = '', caption = '', credit = '', onChange,
}: {
  url?: string | null
  alt?: string
  caption?: string
  credit?: string
  onChange: (patch: Patch) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setBusy(true); setError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/newsroom/upload-image', { method: 'POST', body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error || !data.url) {
        throw new Error(data.error ?? `Upload failed (HTTP ${res.status})`)
      }
      onChange({ leadImageUrl: data.url })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const input = (
    value: string,
    placeholder: string,
    key: keyof Patch,
    hint?: string
  ) => (
    <div style={{ flex: 1, minWidth: 180 }}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={e => onChange({ [key]: e.target.value } as Patch)}
        style={{
          width: '100%', padding: '8px 11px', border: '1px solid var(--border)',
          fontFamily: "'Inter',sans-serif", fontSize: 13, color: 'var(--ink)',
          background: 'var(--paper)', outline: 'none',
        }}
      />
      {hint && <div style={{ fontSize: 10.5, color: 'var(--ink5)', marginTop: 4 }}>{hint}</div>}
    </div>
  )

  if (!url) {
    return (
      <div className="loro-lead-empty">
        <button type="button" className="loro-nr-btn primary" disabled={busy}
          onClick={() => fileInput.current?.click()}>
          {busy ? 'Uploading…' : 'Upload lead image'}
        </button>
        <span className="hint">
          Optional. Appears above the article, and as the image when the story is shared.
        </span>
        {error && <div className="err">{error}</div>}
        <input ref={fileInput} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
      </div>
    )
  }

  return (
    <div className="loro-lead-set">
      <div className="loro-lead-preview">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt || 'Lead image preview'} />
        <button type="button" className="loro-nr-btn danger" onClick={() => onChange({
          leadImageUrl: null, leadImageAlt: '', leadImageCaption: '', leadImageCredit: '',
        })}>Remove</button>
      </div>
      <div className="loro-lead-fields">
        {input(alt, 'Alt text — describe the image', 'leadImageAlt', 'Required for accessibility and search')}
        {input(caption, 'Caption (optional)', 'leadImageCaption')}
        {input(credit, 'Credit (optional)', 'leadImageCredit', 'e.g. Reuters, or the photographer')}
      </div>
      {!(alt ?? '').trim() && (
        <div className="loro-lead-warn">
          No alt text — add a description so the image is accessible and readable by search engines.
        </div>
      )}
      {error && <div className="err">{error}</div>}
    </div>
  )
}
