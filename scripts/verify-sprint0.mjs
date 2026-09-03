// Sprint 0 verification. Pure-function checks, no database or network needed.
//   node scripts/verify-sprint0.mjs

// --- copies of the fixed implementations (kept in step with the routes) ------

function trimHyphens(s) {
  let start = 0, end = s.length
  while (start < end && s.charCodeAt(start) === 45) start++
  while (end > start && s.charCodeAt(end - 1) === 45) end--
  return s.slice(start, end)
}

function slugify(text) {
  const full = trimHyphens(
    text
      .toLowerCase()
      .replace(/[£€$]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
  )
  if (full.length <= 80) return full
  const cut = full.slice(0, 80)
  const lastHyphen = cut.lastIndexOf('-')
  return trimHyphens(lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut)
}

function readingStats(html) {
  const src = html ?? ''
  const lower = src.toLowerCase()
  let out = ''
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt === -1) { out += src.slice(i); break }
    out += src.slice(i, lt) + ' '
    let skipTo = -1
    for (const tag of ['script', 'style']) {
      if (lower.startsWith(`<${tag}`, lt)) {
        const close = lower.indexOf(`</${tag}>`, lt)
        skipTo = close === -1 ? src.length : close + tag.length + 3
        break
      }
    }
    if (skipTo !== -1) { i = skipTo; continue }
    const gt = src.indexOf('>', lt)
    if (gt === -1) break
    i = gt + 1
  }
  const text = out.replace(/&nbsp;/gi, ' ').replace(/&[a-z]{1,10};|&#\d{1,7};/gi, '')
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length
  return { wordCount, readingTimeMins: Math.max(1, Math.round(wordCount / 225)) }
}

// --- assertions -------------------------------------------------------------

let failures = 0
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

console.log('\nslugify — the five live headlines that produced broken slugs\n')

// Real headlines behind the five 80-char slugs in production.
const headlines = [
  'Prompt questions over UK regulatory footprint issuer still has not addressed publicly',
  'Centre of Justice for Palestinians has donated to 3 different recipients this quarter',
  'Signal flags possible UK manufacturer supply chain exposure across three registers',
  'Signal flags possible donation fragmentation pattern at a Westminster level again',
  'Cluster of regulatory disclosures prompting scrutiny of life sciences issuer group',
]

for (const h of headlines) {
  const s = slugify(h)
  ok(
    s.slice(0, 46) + '…',
    s.length <= 80 && !s.endsWith('-') && !/-[a-z]{1,3}$/.test(s),
    `${s.length} chars, ends "${s.split('-').slice(-1)[0]}"`
  )
}

console.log('\nslugify — edge cases\n')
ok('short headline keeps its last word', slugify('Bank of England holds rates') === 'bank-of-england-holds-rates')
ok('no trailing hyphen ever', !slugify('A '.repeat(60)).endsWith('-'))
ok('single very long word is not emptied', slugify('a'.repeat(120)).length === 80)
ok('currency symbols stripped', slugify('£5,000 donation') === '5000-donation')
ok('exactly-80 slug untouched', (() => { const s = slugify('x'.repeat(80)); return s.length === 80 })())

console.log('\nreadingStats\n')
ok('counts words in markup', readingStats('<p>One two three</p>').wordCount === 3)
ok('ignores script bodies', readingStats('<script>var a = 1 + 2 + 3</script><p>One two</p>').wordCount === 2)
ok('nbsp is not a word', readingStats('<p>One&nbsp;two</p>').wordCount === 2)
ok('empty body is zero words', readingStats('').wordCount === 0)
ok('reading time floors at 1', readingStats('<p>Hi</p>').readingTimeMins === 1)
ok('450 words is 2 minutes', readingStats('<p>' + 'word '.repeat(450) + '</p>').readingTimeMins === 2)


console.log('\nReDoS resistance — CodeQL js/polynomial-redos (high)\n')

// The flagged pattern was /^-+|-+$/ on the headline. Quadratic on a long run of
// hyphens; linear now. 100k dashes must not take meaningful time.
let t = Date.now()
slugify('-'.repeat(100000))
const slugMs = Date.now() - t
ok('slugify survives 100k hyphens', slugMs < 1000, `${slugMs}ms`)

// Same class in readingStats: an unterminated <script on uncontrolled body_html.
t = Date.now()
readingStats('<script'.repeat(50000))
const openMs = Date.now() - t
ok('readingStats survives 50k unterminated <script', openMs < 1000, `${openMs}ms`)

t = Date.now()
readingStats('<'.repeat(100000))
const ltMs = Date.now() - t
ok('readingStats survives 100k bare <', ltMs < 1000, `${ltMs}ms`)

ok('script bodies still excluded', readingStats('<script>a b c d e</script><p>One two</p>').wordCount === 2)
ok('style bodies still excluded', readingStats('<style>x { y: z }</style><p>One two</p>').wordCount === 2)
ok('unterminated script drops remainder', readingStats('<p>One two</p><script>a b c').wordCount === 2)

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} FAILED.`}\n`)
process.exit(failures === 0 ? 0 : 1)
