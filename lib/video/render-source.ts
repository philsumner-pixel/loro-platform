import type { LoroVideoScript, LoroDataPoint } from '@/lib/loro-video'
import { LORO_STRAPLINE } from '@/lib/loro-video'

// Loro brand palette for video
const LAPIS = '#10243f'        // deep lapis panel background
const ACCENT = '#5b9bd5'       // light lapis accent
const WHITE = '#ffffff'
const POS = '#3fae6b'
const NEG = '#d4502f'
const SERIF = 'Playfair Display'
const SANS = 'Inter'

type El = Record<string, unknown>

function estimateAudioDuration(narration: string): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length
  return Math.min(75, Math.max(9, Math.round(words * 0.5 * 10) / 10))
}

function brandCard(durationSec: number, lines: { text: string; font: string; size: string; color: string; y: string; weight?: string }[]): El {
  const elements: El[] = [
    // Full-frame lapis panel (a text element whose box fills the frame)
    {
      name: 'Panel', type: 'text', track: 1, time: 0,
      width: '100%', height: '100%', x_alignment: '50%', y_alignment: '50%',
      background_color: LAPIS, fill_color: LAPIS, text: ' ',
    },
  ]
  lines.forEach((l, i) => {
    elements.push({
      name: `Brand-${i}`, type: 'text', track: i + 2, time: 0,
      width: '84%', x_alignment: '50%', y: l.y, y_alignment: '50%',
      font_family: l.font, font_weight: l.weight ?? '400', font_size: l.size,
      fill_color: l.color, text: l.text,
    })
  })
  return { name: 'BrandCard', type: 'composition', track: 1, duration: durationSec, elements }
}

function contentScene(name: string, broll: string, overlay: El[], durationSec: number, panIn: boolean): El {
  const bg: El = broll
    ? {
        name: `${name}-img`, type: 'image', track: 1, time: 0, source: broll,
        fit: 'cover', color_overlay: 'rgba(16,36,63,0.62)',
        animations: [{
          type: 'pan', scope: 'element', easing: 'linear',
          start_x: '50%', end_x: '50%',
          start_scale: panIn ? '100%' : '118%', end_scale: panIn ? '118%' : '100%',
        }],
      }
    : {
        name: `${name}-bg`, type: 'text', track: 1, time: 0,
        width: '100%', height: '100%', background_color: LAPIS, fill_color: LAPIS, text: ' ',
      }
  return { name, type: 'composition', track: 1, duration: durationSec, elements: [bg, ...overlay] }
}

function textEl(name: string, text: string, opts: Partial<El>): El {
  return {
    name, type: 'text', track: 2, time: 0,
    width: '86%', x_alignment: '50%', font_family: SANS, fill_color: WHITE,
    text, ...opts,
  }
}

function dataOverlay(dp: LoroDataPoint): El[] {
  const els: El[] = [
    textEl('dp-label', dp.label, { y: '30%', font_size: '3.4 vmin', font_weight: '600', fill_color: ACCENT, letter_spacing: '8%' }),
    textEl('dp-value', dp.value, { y: '44%', font_family: SERIF, font_size: '15 vmin', font_weight: '700' }),
  ]
  if (dp.delta) {
    const d = String(dp.delta).trim()
    const signed = /^[+-]/.test(d)
    els.push(textEl('dp-delta', dp.delta, {
      y: '56%', font_size: '4.6 vmin', font_weight: '700',
      fill_color: signed ? (d.startsWith('-') ? NEG : POS) : ACCENT,
    }))
  }
  return els
}

export function buildLoroRenderSource(
  script: LoroVideoScript,
  audioUrl: string,
  brollUrls: string[],
  musicUrl?: string,
): object {
  const D = estimateAudioDuration(script.narration || '')
  const dataPoints: LoroDataPoint[] = Array.isArray(script.data_points) ? script.data_points : []

  // The hook is spoken over the clean Loro entry card (no entity name on the open).
  const hookWords = (script.hook || '').trim().split(/\s+/).filter(Boolean).length
  const introDur = Math.min(4.5, Math.max(2.2, Math.round(hookWords * 0.5 * 10) / 10))

  // Remaining narration time is split across the content + exit beats.
  const beatTexts: string[] = [
    ...dataPoints.map(dp => `${dp.label} ${dp.value} ${dp.delta ?? ''}`),
    script.context || '',
    script.what_to_watch || '',
    script.cta || 'Follow Loro for payments intelligence.',
  ]
  const weights = beatTexts.map(t => Math.max(10, t.length))
  const totalW = weights.reduce((a, b) => a + b, 0)
  const remaining = Math.max(4, D - introDur)
  const durs = weights.map(w => Math.max(1.8, Math.round((remaining * w / totalW) * 10) / 10))
  const contentTotal = Math.round(durs.reduce((a, b) => a + b, 0) * 10) / 10
  const total = Math.round((introDur + contentTotal) * 10) / 10

  let bi = 0
  const nextBroll = () => brollUrls[bi++] ?? ''
  let di = 0

  const scenes: El[] = []

  // Entry card — clean Loro ident, voiceover introduces over it
  scenes.push(brandCard(introDur, [
    { text: 'Loro', font: SERIF, size: '15 vmin', color: WHITE, y: '44%', weight: '700' },
    { text: 'Payment Intelligence', font: SANS, size: '3.6 vmin', color: ACCENT, y: '56%', weight: '500' },
  ]))

  // Data points
  dataPoints.forEach((dp, i) => {
    scenes.push(contentScene(`Data-${i}`, nextBroll(), dataOverlay(dp), durs[di++], di % 2 === 0))
  })

  // Context
  scenes.push(contentScene('Context', nextBroll(),
    [textEl('context', script.context || '', { y: '50%', font_size: '5.2 vmin', font_weight: '500', line_height: '128%' })],
    durs[di++], di % 2 === 0))

  // What to watch
  scenes.push(contentScene('Watch', nextBroll(), [
    textEl('watch-eyebrow', 'WHAT TO WATCH', { y: '40%', font_size: '3.2 vmin', font_weight: '700', fill_color: ACCENT, letter_spacing: '10%' }),
    textEl('watch', script.what_to_watch || '', { y: '52%', font_size: '5.2 vmin', font_weight: '500', line_height: '128%' }),
  ], durs[di++], di % 2 === 0))

  // Exit card (CTA) — consistent closing strapline on every clip
  scenes.push(brandCard(durs[di++], [
    { text: 'Loro', font: SERIF, size: '11 vmin', color: WHITE, y: '38%', weight: '700' },
    { text: LORO_STRAPLINE, font: SANS, size: '4.4 vmin', color: WHITE, y: '54%', weight: '500' },
    { text: 'loro.media', font: SANS, size: '3.2 vmin', color: ACCENT, y: '64%', weight: '500' },
  ]))

  const AUDIO = 'Narration'
  const rootAudio: El = { name: AUDIO, type: 'audio', track: 2, time: 0, source: audioUrl }

  const subtitles: El = {
    name: 'Subtitles', type: 'text', track: 3, time: 0, duration: total,
    width: '88%', height: '16%', x_alignment: '50%', y: '73%',
    font_family: SANS, font_weight: '700', font_size: '5.4 vmin',
    fill_color: WHITE, stroke_color: '#0a1424', stroke_width: '0.7 vmin',
    transcript_source: AUDIO, transcript_effect: 'highlight', transcript_color: ACCENT,
    transcript_maximum_length: 32,
  }

  const footerBar: El = {
    name: 'FooterBar', type: 'text', track: 4, time: 0, duration: total,
    width: '100%', height: '9%', x_alignment: '50%', y: '95.5%',
    background_color: 'rgba(16,36,63,0.85)', fill_color: 'rgba(16,36,63,0.85)', text: ' ',
  }
  const footerMark: El = {
    name: 'FooterMark', type: 'text', track: 5, time: 0, duration: total,
    x_alignment: '50%', y: '94.4%', font_family: SERIF, font_weight: '700', font_size: '3.2 vmin',
    fill_color: WHITE, text: 'Loro',
  }
  const footerTag: El = {
    name: 'FooterTag', type: 'text', track: 6, time: 0, duration: total,
    x_alignment: '50%', y: '97.4%', font_family: SANS, font_weight: '500', font_size: '1.9 vmin',
    letter_spacing: '6%', fill_color: ACCENT, text: 'PAYMENT INTELLIGENCE',
  }

  const elements: El[] = [...scenes, rootAudio, subtitles, footerBar, footerMark, footerTag]

  if (musicUrl) {
    elements.push({
      name: 'Music', type: 'audio', track: 7, time: 0, duration: total,
      source: musicUrl, loop: true, volume: '11%',
      animations: [{ type: 'fade', scope: 'element', fade_out: true, duration: 0.8 }],
    })
  }

  return {
    output_format: 'mp4',
    width: 720,
    height: 1280,
    snapshot_time: 1,
    elements,
  }
}
