import { NextResponse } from 'next/server'
import {
  getSupabase,
  startRun,
  completeRun,
  writeNewsCoverageBatch,
  stripTags,
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

  const startedAt = Date.now()
  const runId = await startRun('rss_monitoring')
  const errors: string[] = []
  let totalFound = 0, totalNew = 0, totalDup = 0

  try {
    // Fetch active publications with RSS URLs
    const sb = getSupabase()
    const { data: pubs, error: pubsError } = await sb
      .from('loro_monitored_publications')
      .select('slug, name, rss_url, tier, last_polled_at')
      .eq('active', true)
      .not('rss_url', 'is', null)
      // Least-recently-polled first, so the whole set is covered in rotation.
      // Fetching all 20 feeds sequentially in one run exceeds the 60s function
      // limit; the cron runs every 15 minutes, so a batch of 8 still gives
      // every feed several polls an hour.
      .order('last_polled_at', { ascending: true, nullsFirst: true })
      .limit(Number(new URL(req.url).searchParams.get('batch') ?? 8))

    if (pubsError) {
      await completeRun(runId, { found: 0, new: 0, duplicate: 0 }, [pubsError.message])
      return NextResponse.json({ error: `DB error: ${pubsError.message}` }, { status: 500 })
    }

    if (!pubs?.length) {
      await completeRun(runId, { found: 0, new: 0, duplicate: 0 })
      return NextResponse.json({ message: 'No active RSS feeds configured' })
    }

    // Poll each feed.
    //
    // Even with the writes batched, a slow feed can eat the budget: eight
    // feeds each allowed a 10s fetch timeout is 80s of worst case against a
    // 60s function limit. Stop polling with enough headroom left to record
    // the run — a run that dies mid-loop is stranded in 'running' forever
    // with no error attached, which is how 122 of these went missing in a
    // week without anything reporting a failure.
    const deadline = startedAt + 45_000
    let skippedForTime = 0

    for (const pub of pubs) {
      if (Date.now() > deadline) {
        skippedForTime++
        continue
      }
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

        // UN-GATED: ingest everything the feed carries and record whether it
        // matched the old payments keyword list, rather than dropping it at
        // collection. Relevance is now decided downstream on the embedded
        // corpus, where it can be judged semantically instead of by keyword.
        const batch = items
          .filter(item => item.link && item.title)
          .map(item => {
            const text = `${item.title} ${item.description}`
            return {
              keyword_relevant: isRelevant(text),
              publication: pub.slug,
              headline: item.title,
              summary: stripTags(item.description).slice(0, 500),
              url: item.link,
              published_at: item.pubDate
                ? new Date(item.pubDate).toISOString()
                : new Date().toISOString(),
              categories_detected: detectCategories(text),
            }
          })

        const { inserted, duplicate } = await writeNewsCoverageBatch(batch)
        totalNew += inserted
        totalDup += duplicate

        // Update last_polled_at
        await sb
          .from('loro_monitored_publications')
          .update({ last_polled_at: new Date().toISOString() })
          .eq('slug', pub.slug)

      } catch (err) {
        errors.push(`${pub.slug}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    // Feeds skipped for time are not an error — they keep their old
    // last_polled_at, so the rotation picks them up first next run. Report it
    // so a persistently short run is visible rather than silent.
    const notes = skippedForTime
      ? [...errors, `${skippedForTime} feed(s) skipped: 45s budget reached`]
      : errors

    await completeRun(runId, { found: totalFound, new: totalNew, duplicate: totalDup }, notes)

    return NextResponse.json({
      run_id: runId,
      elapsed_ms: Date.now() - startedAt,
      feeds_skipped_for_time: skippedForTime || undefined,
      feeds_polled: pubs.length - skippedForTime,
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
