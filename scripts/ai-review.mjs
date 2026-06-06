#!/usr/bin/env node
/**
 * AI code review agent.
 * Sends the diff for the current push/PR to Claude and asks for a focused
 * review: security holes, auth gaps, missing error handling, logic flaws.
 * Writes findings to the GitHub Actions step summary, and (on PRs) posts a comment.
 *
 * Requires env:
 *   ANTHROPIC_API_KEY  (repo secret)
 *   GITHUB_TOKEN       (auto-provided by Actions)
 *   DIFF               (the unified diff to review)
 *   GITHUB_STEP_SUMMARY, GITHUB_EVENT_PATH, GITHUB_REPOSITORY (auto)
 */

import fs from 'node:fs'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.log('No ANTHROPIC_API_KEY set — skipping AI review.')
  process.exit(0)
}

const diff = (process.env.DIFF || '').slice(0, 60000) // cap payload
if (!diff.trim()) {
  console.log('Empty diff — nothing to review.')
  process.exit(0)
}

const SYSTEM = `You are a senior engineer reviewing a code change to a Next.js + Supabase
intelligence-publishing platform. Review ONLY the diff provided. Be concise and specific.

Focus, in priority order:
1. Security — exposed secrets, auth/session gaps, injection, unsafe data handling, RLS assumptions
2. Correctness — logic flaws, unhandled errors, missing null/await, broken types
3. Data integrity — Supabase writes without validation, generated-column inserts, missing client_id scoping

Rules:
- If the change is clean, say so in one line. Do not invent problems.
- For each real issue: file, what, why it matters, suggested fix. One or two sentences each.
- Rank issues: BLOCKER / WARNING / NOTE. Lead with BLOCKERs.
- Ignore style/formatting — that is the linter's job.
- Max ~250 words.`

async function review() {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Review this diff:\n\n\`\`\`diff\n${diff}\n\`\`\`` }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`Anthropic API error ${res.status}: ${body.slice(0, 500)}`)
    process.exit(0) // never block the pipeline on a review failure
  }

  const data = await res.json()
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()

  return text || '_No review output._'
}

function writeSummary(body) {
  const md = `## AI code review\n\n${body}\n\n_Automated review by Claude. Advisory — use judgement._`
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n')
  }
  console.log(md)
  return md
}

async function postPrComment(body) {
  const token = process.env.GITHUB_TOKEN
  const eventPath = process.env.GITHUB_EVENT_PATH
  const repo = process.env.GITHUB_REPOSITORY
  if (!token || !eventPath || !repo) return

  let event
  try { event = JSON.parse(fs.readFileSync(eventPath, 'utf8')) } catch { return }
  const prNumber = event.pull_request?.number
  if (!prNumber) return // only comment on PRs

  const [owner, name] = repo.split('/')
  await fetch(`https://api.github.com/repos/${owner}/${name}/issues/${prNumber}/comments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ body }),
  }).catch(e => console.error('PR comment failed:', e.message))
}

const result = await review()
const md = writeSummary(result)
await postPrComment(md)
