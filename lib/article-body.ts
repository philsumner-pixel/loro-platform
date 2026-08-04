// Block-aware splitting of article body HTML for ad injection.
//
// The previous approach sliced the HTML string at the first '</p>'. That broke
// in three ways once the rich editor was in real use:
//   1. A pull quote (<blockquote><p>…</p></blockquote>) has its first '</p>'
//      INSIDE the blockquote, so the split produced an unclosed <blockquote>
//      in one half and a stray closing tag in the other.
//   2. An image placed straight after paragraph one had the ad shoved between
//      the paragraph and the picture it illustrates.
//   3. An article opening with a figure or list had no '</p>' early enough and
//      got no ad at all.
//
// This splits on TOP-LEVEL blocks only and picks a slot that doesn't separate
// a paragraph from a figure that follows it.

/** Split HTML into top-level blocks, respecting nesting. */
export function splitTopLevelBlocks(html: string): string[] {
  const blocks: string[] = []
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g

  let depth = 0
  let start = 0
  let match: RegExpExecArray | null

  // Void elements never open a nesting level.
  const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source'])

  while ((match = tagRe.exec(html)) !== null) {
    const [full, closing, rawName, selfClose] = match
    const name = rawName.toLowerCase()
    if (VOID.has(name) || selfClose === '/') continue

    if (closing === '/') {
      depth--
      if (depth === 0) {
        const end = match.index + full.length
        const block = html.slice(start, end).trim()
        if (block) blocks.push(block)
        start = end
      }
    } else {
      depth++
    }
  }

  const tail = html.slice(start).trim()
  if (tail) blocks.push(tail)
  return blocks
}

function isFigure(block: string): boolean {
  return /^<(figure|img)\b/i.test(block.trim())
}

function isParagraph(block: string): boolean {
  return /^<p\b/i.test(block.trim())
}

/**
 * Choose where the in-article ad goes and return the two halves.
 *
 * Rules, in order:
 *   - only ever break BETWEEN top-level blocks, never inside one
 *   - prefer after a paragraph that is not immediately followed by a figure
 *   - never place the ad before any real content
 *   - if no suitable slot exists (very short piece), render the body whole
 */
export function splitForAd(bodyHtml: string): { beforeAd: string; afterAd: string } {
  const blocks = splitTopLevelBlocks(bodyHtml)

  // Too short to interrupt — don't inject.
  if (blocks.length < 3) {
    return { beforeAd: '', afterAd: bodyHtml }
  }

  let slot = -1
  for (let i = 0; i < blocks.length - 1; i++) {
    if (!isParagraph(blocks[i])) continue
    // Don't separate a paragraph from a figure that illustrates it.
    if (isFigure(blocks[i + 1])) continue
    slot = i
    break
  }

  // Every early paragraph is followed by a figure — fall back to the first
  // gap after a figure instead, so the ad still appears somewhere sensible.
  if (slot === -1) {
    for (let i = 0; i < blocks.length - 1; i++) {
      if (isFigure(blocks[i]) && !isFigure(blocks[i + 1])) { slot = i; break }
    }
  }

  if (slot === -1) {
    return { beforeAd: '', afterAd: bodyHtml }
  }

  return {
    beforeAd: blocks.slice(0, slot + 1).join('\n'),
    afterAd: blocks.slice(slot + 1).join('\n'),
  }
}
