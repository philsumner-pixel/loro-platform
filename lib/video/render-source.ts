import type { LoroVideoScript, LoroDataPoint } from '@/lib/loro-video'
import { LORO_STRAPLINE } from '@/lib/loro-video'
import type { Cue } from '@/lib/video/elevenlabs'

// Loro "data world" palette
const LAPIS = '#0a1a2f'
const ACCENT = '#6aa6e0'
const WHITE = '#eaf1f9'
const WARM = '#f4ecdf'
const POS = '#4ec07e'
const NEG = '#e0654a'
const SERIF = 'Playfair Display'
const SANS = 'Inter'

type El = Record<string, unknown>

function estimateAudioDuration(narration: string): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length
  return Math.min(75, Math.max(9, Math.round(words * 0.5 * 10) / 10))
}

// Enter transitions (fade + scale — the primitives confirmed to render)
const FADE = (duration = 0.5, time = 0): El => ({ type: 'fade', scope: 'element', time, duration })
const POP = (start = '55%', duration = 0.6, time = 0): El =>
  ({ type: 'scale', scope: 'element', start_scale: start, end_scale: '100%', easing: 'quadratic-out', time, duration })

// Solid rectangle. Creatomate paints text background_color only behind glyphs,
// so all fills must be real shape elements with a full-box path.
function rect(name: string, fillColor: string, opts: Partial<El>): El {
  return { name, type: 'shape', time: 0, fill_color: fillColor,
    path: 'M 0 0 L 100 0 L 100 100 L 0 100 Z', ...opts }
}

function txt(name: string, text: string, opts: Partial<El>): El {
  return { name, type: 'text', track: 2, time: 0, width: '86%', x_alignment: '50%',
    font_family: SANS, fill_color: WHITE, text, ...opts }
}

function worldScene(name: string, durationSec: number, overlay: El[]): El {
  return { name, type: 'composition', track: 2, duration: durationSec, elements: overlay }
}

function dataOverlay(dp: LoroDataPoint, withBars: boolean): El[] {
  const els: El[] = [
    txt('dp-label', dp.label, { y: '32%', track: 2, font_size: '3.4 vmin', font_weight: '600',
      fill_color: ACCENT, letter_spacing: '8%', animations: [FADE(0.4)] }),
    txt('dp-value', dp.value, { y: '45%', track: 3, font_family: SERIF, font_size: '17 vmin',
      font_weight: '700', fill_color: WARM, animations: [FADE(0.5), POP('45%', 0.7)] }),
    rect('dp-rule', ACCENT, { track: 2, width: '16%', height: '0.6%', x_alignment: '50%', y: '53%',
      animations: [FADE(0.5, 0.2)] }),
  ]
  if (dp.delta) {
    const d = String(dp.delta).trim()
    const signed = /^[+-]/.test(d)
    els.push(txt('dp-delta', dp.delta, { y: '60%', track: 4, font_size: '4.4 vmin', font_weight: '700',
      fill_color: signed ? (d.startsWith('-') ? NEG : POS) : ACCENT, animations: [FADE(0.4, 0.3)] }))
  }
  if (withBars) {
    const heights = [38, 60, 30, 80]
    heights.forEach((h, i) => {
      els.push(rect(`bar-${i}`, i === 3 ? '#7fb6ea' : i === 2 ? '#3f6fa0' : ACCENT, {
        track: 3, width: '7%', height: `${(h * 0.18).toFixed(1)}%`,
        x: `${36 + i * 9}%`, y: '72%', y_alignment: '100%',
        animations: [FADE(0.4, 0.4 + i * 0.12), POP('60%', 0.5, 0.4 + i * 0.12)],
      }))
    })
  }
  return els
}

export function buildLoroRenderSource(
  script: LoroVideoScript,
  audioUrl: string,
  cues: Cue[],
  audioDuration: number,
  entityName: string,
  musicUrl?: string,
): object {
  const D = audioDuration > 0 ? audioDuration : estimateAudioDuration(script.narration || '')
  const dataPoints: LoroDataPoint[] = Array.isArray(script.data_points) ? script.data_points : []

  const hookWords = (script.hook || '').trim().split(/\s+/).filter(Boolean).length
  const introDur = Math.min(4.5, Math.max(2.2, Math.round(hookWords * 0.5 * 10) / 10))

  const beatTexts: string[] = [
    ...dataPoints.map(dp => `${dp.label} ${dp.value} ${dp.delta ?? ''}`),
    script.context || '',
    script.what_to_watch || '',
    script.cta || LORO_STRAPLINE,
  ]
  const weights = beatTexts.map(t => Math.max(10, t.length))
  const totalW = weights.reduce((a, b) => a + b, 0)
  const remaining = Math.max(4, D - introDur)
  const durs = weights.map(w => Math.max(1.8, Math.round((remaining * w / totalW) * 10) / 10))
  const contentTotal = Math.round(durs.reduce((a, b) => a + b, 0) * 10) / 10
  const total = Math.round((introDur + contentTotal) * 10) / 10

  let di = 0
  const scenes: El[] = []

  // Entry — clean Loro ident in the lapis world
  scenes.push(worldScene('Entry', introDur, [
    txt('ident', 'Loro', { y: '44%', font_family: SERIF, font_size: '15 vmin', font_weight: '700',
      fill_color: WHITE, animations: [FADE(0.6), POP('70%', 0.8)] }),
    txt('ident-tag', 'Payment Intelligence', { y: '56%', font_size: '3.6 vmin', font_weight: '500',
      fill_color: ACCENT, animations: [FADE(0.6, 0.3)] }),
  ]))

  // Data scenes (first carries the bar motif)
  dataPoints.forEach((dp, i) => {
    scenes.push(worldScene(`Data-${i}`, durs[di++], dataOverlay(dp, i === 0)))
  })

  // Context
  scenes.push(worldScene('Context', durs[di++], [
    txt('context', script.context || '', { y: '46%', font_family: SERIF, font_size: '5.8 vmin',
      font_weight: '400', line_height: '136%', animations: [FADE(0.5), POP('90%', 0.6)] }),
  ]))

  // What to watch
  scenes.push(worldScene('Watch', durs[di++], [
    txt('watch-eyebrow', 'WHAT TO WATCH', { y: '36%', font_size: '3.2 vmin', font_weight: '700',
      fill_color: ACCENT, letter_spacing: '10%', animations: [FADE(0.4)] }),
    txt('watch', script.what_to_watch || '', { y: '48%', font_family: SERIF, font_size: '5.8 vmin',
      font_weight: '400', line_height: '136%', animations: [FADE(0.5, 0.15), POP('92%', 0.6, 0.15)] }),
  ]))

  // Exit — consistent strapline
  scenes.push(worldScene('Exit', durs[di++], [
    txt('exit-mark', 'Loro', { y: '38%', font_family: SERIF, font_size: '11 vmin', font_weight: '700',
      fill_color: WHITE, animations: [FADE(0.5), POP('70%', 0.6)] }),
    txt('exit-strap', LORO_STRAPLINE, { y: '54%', font_size: '4.4 vmin', font_weight: '500',
      fill_color: WHITE, animations: [FADE(0.5, 0.2)] }),
    txt('exit-url', 'loro.media', { y: '64%', font_size: '3.2 vmin', font_weight: '500',
      fill_color: ACCENT, animations: [FADE(0.5, 0.3)] }),
  ]))

  // World floor — full-frame lapis behind everything
  const world = rect('World', LAPIS, { track: 1, time: 0, duration: total,
    width: '100%', height: '100%', x_alignment: '50%', y_alignment: '50%' })

  const AUDIO = 'Narration'
  const rootAudio: El = { name: AUDIO, type: 'audio', track: 3, time: 0, source: audioUrl }

  // Persistent Loro wordmark (channel bug) + entity line
  const loroBug: El = {
    name: 'LoroBug', type: 'text', track: 5, time: 0, duration: total,
    x_alignment: '50%', y: '5.5%', font_family: SERIF, font_weight: '700', font_size: '3.6 vmin',
    fill_color: WHITE, text: 'Loro',
  }
  const entityHeader: El[] = entityName ? [{
    name: 'EntityName', type: 'text', track: 6, time: introDur, duration: contentTotal,
    x_alignment: '50%', y: '13.5%', font_family: SANS, font_weight: '600', font_size: '3.8 vmin',
    letter_spacing: '2%', fill_color: ACCENT, text: entityName, animations: [FADE(0.5)],
  }] : []

  // Captions from the exact script text
  const cueEls: El[] = cues.map((c, i) => ({
    name: `Cue-${i}`, type: 'text', track: 4,
    time: Math.round(c.start * 100) / 100,
    duration: Math.max(0.4, Math.round((c.end - c.start) * 100) / 100),
    width: '86%', x_alignment: '50%', y: '80%',
    font_family: SANS, font_weight: '700', font_size: '5 vmin',
    fill_color: WHITE, stroke_color: '#04101f', stroke_width: '0.7 vmin',
    text: c.text,
  }))

  const footerBar = rect('FooterBar', 'rgba(6,16,30,0.92)', {
    track: 7, time: 0, duration: total, width: '100%', height: '9%',
    x_alignment: '50%', y: '100%', y_alignment: '100%',
  })
  const footerMark: El = {
    name: 'FooterMark', type: 'text', track: 8, time: 0, duration: total,
    x_alignment: '50%', y: '94.4%', font_family: SERIF, font_weight: '700', font_size: '3.2 vmin',
    fill_color: WHITE, text: 'Loro',
  }
  const footerTag: El = {
    name: 'FooterTag', type: 'text', track: 9, time: 0, duration: total,
    x_alignment: '50%', y: '97.4%', font_family: SANS, font_weight: '500', font_size: '1.9 vmin',
    letter_spacing: '6%', fill_color: ACCENT, text: 'PAYMENT INTELLIGENCE',
  }

  const elements: El[] = [world, ...scenes, rootAudio, loroBug, ...entityHeader, ...cueEls, footerBar, footerMark, footerTag]
  if (musicUrl) {
    elements.push({ name: 'Music', type: 'audio', track: 10, time: 0, duration: total,
      source: musicUrl, loop: true, volume: '11%',
      animations: [{ type: 'fade', scope: 'element', fade_out: true, duration: 0.8 }] })
  }

  return { output_format: 'mp4', width: 720, height: 1280, fill_color: LAPIS, snapshot_time: 1, elements }
}
