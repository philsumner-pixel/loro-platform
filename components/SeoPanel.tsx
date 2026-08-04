'use client'

import { useState } from 'react'

// SEO / answer-engine panel for the draft editor.
//
// Collapsed by default: most stories don't need it, and the fallbacks
// (headline, standfirst) are sensible. Opens when a journalist wants a
// distinct search headline — which is normal, since a display headline is
// often written for punch rather than for the question a reader would type.

const TITLE_MAX = 60      // ~600px, where Google truncates
const DESC_MAX = 155

export default function SeoPanel({
  headline, standfirst, slug,
  seoTitle, seoDescription, seoKeywords,
  onChange,
}: {
  headline: string
  standfirst: string
  slug?: string
  seoTitle: string
  seoDescription: string
  seoKeywords: string
  onChange: (patch: {
    seoTitle?: string; seoDescription?: string; seoKeywords?: string
  }) => void
}) {
  const [open, setOpen] = useState(false)

  const effectiveTitle = seoTitle.trim() || headline
  const effectiveDesc = seoDescription.trim() || standfirst

  const counter = (value: string, max: number) => {
    const n = value.length
    const state = n === 0 ? 'muted' : n > max ? 'over' : n > max * 0.9 ? 'near' : 'ok'
    return <span className={`loro-seo-count ${state}`}>{n}/{max}</span>
  }

  return (
    <div className="loro-seo">
      <button type="button" className="loro-seo-toggle" onClick={() => setOpen(o => !o)}>
        <span>{open ? '▾' : '▸'} Search &amp; AI visibility</span>
        <span className="loro-seo-sub">
          {seoTitle || seoDescription || seoKeywords
            ? 'Customised'
            : 'Using headline and standfirst'}
        </span>
      </button>

      {open && (
        <div className="loro-seo-body">
          <p className="loro-seo-help">
            Optional. Left blank, the headline and standfirst are used. Worth setting when
            the display headline differs from how someone would actually ask the question —
            answer engines match on the question, not the flourish.
          </p>

          <div className="loro-seo-field">
            <label>
              Search headline {counter(seoTitle, TITLE_MAX)}
            </label>
            <input
              value={seoTitle}
              placeholder={headline}
              onChange={e => onChange({ seoTitle: e.target.value })}
            />
          </div>

          <div className="loro-seo-field">
            <label>
              Meta description {counter(seoDescription, DESC_MAX)}
            </label>
            <textarea
              rows={2}
              value={seoDescription}
              placeholder={standfirst}
              onChange={e => onChange({ seoDescription: e.target.value })}
            />
          </div>

          <div className="loro-seo-field">
            <label>Keywords <span className="loro-seo-count muted">comma separated</span></label>
            <input
              value={seoKeywords}
              placeholder="e.g. PDMR, insider dealing, payments regulation"
              onChange={e => onChange({ seoKeywords: e.target.value })}
            />
          </div>

          <div className="loro-seo-preview">
            <div className="loro-seo-preview-label">Preview</div>
            <div className="loro-seo-url">
              loro.media › news › {slug ?? headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}
            </div>
            <div className="loro-seo-title">
              {effectiveTitle.length > TITLE_MAX
                ? effectiveTitle.slice(0, TITLE_MAX) + '…'
                : effectiveTitle}
            </div>
            <div className="loro-seo-desc">
              {effectiveDesc.length > DESC_MAX
                ? effectiveDesc.slice(0, DESC_MAX) + '…'
                : effectiveDesc || 'No description — the standfirst will be used.'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
