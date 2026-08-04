'use client'

import { useState } from 'react'

// Agentic-search block.
//
// Answer engines lift the passage that most directly answers a question, with
// specific figures and attributable sources. Rather than hoping such a passage
// exists somewhere in the prose, the article carries one explicitly: a short
// direct answer, discrete key facts, and the questions a reader would ask.
// Rendered visibly on the page (crawlable, and genuinely useful) and emitted
// as schema.org so it can be lifted.

export interface KeyFact { label: string; value: string; source_url?: string }
export interface FaqItem { question: string; answer: string }

export default function AnswerBlockPanel({
  answerSummary, keyFacts, faq, onChange,
}: {
  answerSummary: string
  keyFacts: KeyFact[]
  faq: FaqItem[]
  onChange: (patch: {
    answerSummary?: string; keyFacts?: KeyFact[]; faq?: FaqItem[]
  }) => void
}) {
  const [open, setOpen] = useState(false)
  const filled = Boolean(answerSummary || keyFacts.length || faq.length)

  const setFact = (i: number, patch: Partial<KeyFact>) =>
    onChange({ keyFacts: keyFacts.map((f, n) => n === i ? { ...f, ...patch } : f) })
  const setFaq = (i: number, patch: Partial<FaqItem>) =>
    onChange({ faq: faq.map((f, n) => n === i ? { ...f, ...patch } : f) })

  return (
    <div className="loro-seo">
      <button type="button" className="loro-seo-toggle" onClick={() => setOpen(o => !o)}>
        <span>{open ? '▾' : '▸'} Answer block (agentic search)</span>
        <span className="loro-seo-sub">
          {filled
            ? `${keyFacts.length} facts · ${faq.length} questions`
            : 'Not set — engines will lift from the prose'}
        </span>
      </button>

      {open && (
        <div className="loro-seo-body">
          <p className="loro-seo-help">
            What an answer engine quotes when someone asks about this story. Lead with the
            specific figure, not context — the whole point is that it can be lifted verbatim
            and stands up on its own.
          </p>

          <div className="loro-seo-field">
            <label>Direct answer <span className="loro-seo-count muted">1–2 sentences</span></label>
            <textarea
              rows={2}
              value={answerSummary}
              placeholder="Four PDMR disposals were filed at X within 11 days, according to filings dated…"
              onChange={e => onChange({ answerSummary: e.target.value })}
            />
          </div>

          <div className="loro-seo-field">
            <label>Key facts <span className="loro-seo-count muted">discrete and checkable</span></label>
            {keyFacts.map((f, i) => (
              <div key={i} className="loro-fact-row">
                <input
                  value={f.label} placeholder="Label, e.g. Filings detected"
                  onChange={e => setFact(i, { label: e.target.value })}
                />
                <input
                  value={f.value} placeholder="Value, e.g. 4 in 11 days"
                  onChange={e => setFact(i, { value: e.target.value })}
                />
                <input
                  value={f.source_url ?? ''} placeholder="Source URL (optional)"
                  onChange={e => setFact(i, { source_url: e.target.value })}
                />
                <button type="button" className="loro-nr-btn"
                  onClick={() => onChange({ keyFacts: keyFacts.filter((_, n) => n !== i) })}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="loro-nr-btn"
              onClick={() => onChange({ keyFacts: [...keyFacts, { label: '', value: '' }] })}>
              + Add fact
            </button>
          </div>

          <div className="loro-seo-field">
            <label>Questions readers ask <span className="loro-seo-count muted">emitted as FAQPage schema</span></label>
            {faq.map((f, i) => (
              <div key={i} className="loro-faq-row">
                <input
                  value={f.question} placeholder="Question"
                  onChange={e => setFaq(i, { question: e.target.value })}
                />
                <textarea
                  rows={2} value={f.answer} placeholder="Answer — one or two sentences"
                  onChange={e => setFaq(i, { answer: e.target.value })}
                />
                <button type="button" className="loro-nr-btn"
                  onClick={() => onChange({ faq: faq.filter((_, n) => n !== i) })}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="loro-nr-btn"
              onClick={() => onChange({ faq: [...faq, { question: '', answer: '' }] })}>
              + Add question
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
