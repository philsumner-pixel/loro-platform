import { NextResponse } from 'next/server'
import {
  getSupabase,
  startRun,
  completeRun,
  writeNewsCoverage,
  extractRssItems,
  isRelevant,
  detectCategories,
} from '@/lib/ingest/utils'

// Vercel cron will call this every 15 minutes
// vercel.json: { "crons": [{ "path": "/api/ingest/rss", "schedule": "*/15 * * * *" }] }

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request) {
  // Simple auth — cron secret or internal call
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startRun('rss_monitoring')
  const errors: string[] = []
  let totalFound = 0, totalNew = 0, totalDup = 0

  try {
    // Fetch active publications with RSS URLs
    const sb = getSupabase()
    const { data: pubs, error: pubsError } = await sb
      .from('loro_monitored_publications')
      .select('slug, name, rss_url, tier')
      .eq('active', true)
      .not('rss_url', 'is', null)
      .order('tier', { ascending: true })

    if (pubsError) {
      await completeRun(runId, { found: 0, new: 0, duplicate: 0 }, [pubsError.message])
      return NextResponse.json({ error: `DB error: ${pubsError.message}` }, { status: 500 })
    }

    if (!pubs?.length) {
      await completeRun(runId, { found: 0, new: 0, duplicate: 0 })
      return NextResponse.json({ message: 'No active RSS feeds configured' })
    }

    // Poll each feed
    for (const pub of pubs) {
      try {
        const res = await fetch(pub.rss_url!, {
          headers: { 'User-Agent': 'Loro-Intelligence-Bot/1.0 (+https://loro.co/bot)' },
          signal: AbortSignal.timeout(10000),
        })

        if (!res.ok) {
          errors.push(`${pub.slug}: HTTP ${res.status}`)
          continue
        }

        const xml = await res.text()
        const items = extractRssItems(xml)
        totalFound += items.length

        for (const item of items) {
          if (!item.link || !item.title) continue

          // Only ingest payments-relevant content
          const text = `${item.title} ${item.description}`
          if (!isRelevant(text)) continue

          const written = await writeNewsCoverage({
            publication: pub.slug,
            headline: item.title,
            summary: item.description.replace(/<[^>]+>/g, '').slice(0, 500),
            url: item.link,
            published_at: item.pubDate
              ? new Date(item.pubDate).toISOString()
              : new Date().toISOString(),
            categories_detected: detectCategories(text),
          })

          if (written) totalNew++
          else totalDup++
        }

        // Update last_polled_at
        await sb
          .from('loro_monitored_publications')
          .update({ last_polled_at: new Date().toISOString() })
          .eq('slug', pub.slug)

      } catch (err) {
        errors.push(`${pub.slug}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    await completeRun(runId, { found: totalFound, new: totalNew, duplicate: totalDup }, errors)

    return NextResponse.json({
      run_id: runId,
      feeds_polled: pubs.length,
      items_found: totalFound,
      items_new: totalNew,
      items_duplicate: totalDup,
      errors: errors.length ? errors : undefined,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    errors.push(msg)
    await completeRun(runId, { found: totalFound, new: totalNew, duplicate: totalDup }, errors)
    return NextResponse.json({ error: msg, run_id: runId }, { status: 500 })
  }
}
