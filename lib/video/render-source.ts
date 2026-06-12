import type { LoroVideoScript, LoroDataPoint } from '@/lib/loro-video'

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
      width: '84%', x_alignment: '50%', y_alignment: l.y,
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
        fit: 'cover', color_overlay: 'rgba(8,14,28,0.58)',
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
    textEl('dp-label', dp.label, { y_alignment: '40%', font_size: '3.4 vmin', font_weight: '600', fill_color: ACCENT, letter_spacing: '8%' }),
    textEl('dp-value', dp.value, { y_alignment: '50%', font_family: SERIF, font_size: '15 vmin', font_weight: '700' }),
  ]
  if (dp.delta) {
    els.push(textEl('dp-delta', dp.delta, {
      y_alignment: '62%', font_size: '5 vmin', font_weight: '700',
      fill_color: String(dp.delta).trim().startsWith('-') ? NEG : POS,
    }))
  }
  return els
}

export function buildLoroRenderSource(
  script: LoroVideoScript,
  audioUrl: string,
  brollUrls: string[],
  entityName: string,
): object {
  const introDur = 2.3
  const D = estimateAudioDuration(script.narration || '')
  const dataPoints: LoroDataPoint[] = Array.isArray(script.data_points) ? script.data_points : []

  const beatTexts: string[] = [
    script.hook || entityName,
    ...dataPoints.map(dp => `${dp.label} ${dp.value} ${dp.delta ?? ''}`),
    script.context || '',
    script.what_to_watch || '',
    script.cta || 'Follow Loro for payments intelligence.',
  ]
  const weights = beatTexts.map(t => Math.max(10, t.length))
  const totalW = weights.reduce((a, b) => a + b, 0)
  const durs = weights.map(w => Math.max(1.8, Math.round((D * w / totalW) * 10) / 10))
  const contentTotal = Math.round(durs.reduce((a, b) => a + b, 0) * 10) / 10
  const total = Math.round((introDur + contentTotal) * 10) / 10

  let bi = 0
  const nextBroll = () => brollUrls[bi++] ?? ''
  let di = 0

  const scenes: El[] = []

  // Entry card
  scenes.push(brandCard(introDur, [
    { text: 'Loro', font: SERIF, size: '13 vmin', color: WHITE, y: '40%', weight: '700' },
    { text: 'Payment Intelligence', font: SANS, size: '3.4 vmin', color: ACCENT, y: '52%', weight: '500' },
    { text: entityName, font: SANS, size: '4.6 vmin', color: WHITE, y: '62%', weight: '600' },
  ]))

  // Hook
  scenes.push(contentScene('Hook', nextBroll(),
    [textEl('hook', script.hook || '', { y_alignment: '48%', font_family: SERIF, font_size: '7.5 vmin', font_weight: '700' })],
    durs[di++], di % 2 === 0))

  // Data points
  dataPoints.forEach((dp, i) => {
    scenes.push(contentScene(`Data-${i}`, nextBroll(), dataOverlay(dp), durs[di++], di % 2 === 0))
  })

  // Context
  scenes.push(contentScene('Context', nextBroll(),
    [textEl('context', script.context || '', { y_alignment: '50%', font_size: '5.2 vmin', font_weight: '500', line_height: '128%' })],
    durs[di++], di % 2 === 0))

  // What to watch
  scenes.push(contentScene('Watch', nextBroll(), [
    textEl('watch-eyebrow', 'WHAT TO WATCH', { y_alignment: '38%', font_size: '3.2 vmin', font_weight: '700', fill_color: ACCENT, letter_spacing: '10%' }),
    textEl('watch', script.what_to_watch || '', { y_alignment: '50%', font_size: '5.2 vmin', font_weight: '500', line_height: '128%' }),
  ], durs[di++], di % 2 === 0))

  // Exit card (CTA) — carries the closing narration line
  scenes.push(brandCard(durs[di++], [
    { text: 'Loro', font: SERIF, size: '11 vmin', color: WHITE, y: '38%', weight: '700' },
    { text: script.cta || 'Follow Loro for payments intelligence.', font: SANS, size: '4.2 vmin', color: WHITE, y: '54%', weight: '500' },
    { text: 'loro.media', font: SANS, size: '3.2 vmin', color: ACCENT, y: '64%', weight: '500' },
  ]))

  const AUDIO = 'Narration'
  const rootAudio: El = { name: AUDIO, type: 'audio', track: 2, time: introDur, source: audioUrl }

  const subtitles: El = {
    name: 'Subtitles', type: 'text', track: 3, time: introDur, duration: contentTotal,
    width: '88%', height: '24%', x_alignment: '50%', y_alignment: '80%',
    font_family: SANS, font_weight: '700', font_size: '5.4 vmin',
    fill_color: WHITE, stroke_color: '#0a1424', stroke_width: '0.7 vmin',
    transcript_source: AUDIO, transcript_effect: 'highlight', transcript_color: ACCENT,
    transcript_maximum_length: 32,
  }

  const watermark: El = {
    name: 'Watermark', type: 'text', track: 4, time: 0, duration: total,
    x_alignment: '50%', y_alignment: '94%',
    font_family: SERIF, font_weight: '700', font_size: '3.4 vmin',
    fill_color: 'rgba(255,255,255,0.6)', text: 'Loro',
  }

  return {
    output_format: 'mp4',
    width: 720,
    height: 1280,
    snapshot_time: 1,
    elements: [...scenes, rootAudio, subtitles, watermark],
  }
}
