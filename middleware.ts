import { NextResponse, type NextRequest } from 'next/server'

// Inbound AI-crawler logging.
//
// Every time GPTBot or PerplexityBot fetches a page that is a fact, with a
// timestamp — not an inference. It is first-party, free, and nobody else has
// it for our content. Joined to citation outcomes it tells us whether a piece
// that isn't being cited was never crawled (an access problem) or was crawled
// and passed over (a content problem). Those need completely different fixes,
// and outbound-only tools can't distinguish them.
//
// Logging is fire-and-forget: a failure here must never affect the response.

interface BotDef {
  name: string
  match: RegExp
  live?: boolean   // user-triggered fetch, i.e. someone asked a question NOW
}

const BOTS: BotDef[] = [
  { name: 'GPTBot',            match: /GPTBot/i },
  { name: 'OAI-SearchBot',     match: /OAI-SearchBot/i },
  { name: 'ChatGPT-User',      match: /ChatGPT-User/i, live: true },
  { name: 'ClaudeBot',         match: /ClaudeBot/i },
  { name: 'Claude-User',       match: /Claude-User/i, live: true },
  { name: 'Claude-SearchBot',  match: /Claude-SearchBot/i },
  { name: 'PerplexityBot',     match: /PerplexityBot/i },
  { name: 'Perplexity-User',   match: /Perplexity-User/i, live: true },
  { name: 'Google-Extended',   match: /Google-Extended/i },
  { name: 'Googlebot',         match: /Googlebot/i },
  { name: 'Bingbot',           match: /bingbot/i },
  { name: 'Applebot-Extended', match: /Applebot-Extended/i },
  { name: 'Applebot',          match: /Applebot/i },
  { name: 'Amazonbot',         match: /Amazonbot/i },
  { name: 'Bytespider',        match: /Bytespider/i },
  { name: 'CCBot',             match: /CCBot/i },
  { name: 'meta-externalagent',match: /meta-externalagent/i },
  { name: 'DuckAssistBot',     match: /DuckAssistBot/i },
  { name: 'YouBot',            match: /YouBot/i },
  { name: 'cohere-ai',         match: /cohere-ai/i },
  { name: 'Diffbot',           match: /Diffbot/i },
]

function identify(ua: string): BotDef | null {
  for (const bot of BOTS) {
    if (bot.match.test(ua)) return bot
  }
  return null
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()

  try {
    const ua = req.headers.get('user-agent') ?? ''
    if (!ua) return res

    const bot = identify(ua)
    if (!bot) return res

    const path = req.nextUrl.pathname
    const slug = path.startsWith('/news/') ? path.slice('/news/'.length) : null

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return res

    // Fire-and-forget. Not awaited: a logging failure or slow write must never
    // delay or break the crawler's response.
    void fetch(`${url}/rest/v1/loro_bot_hits`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        bot_name: bot.name,
        user_agent: ua.slice(0, 500),
        path,
        article_slug: slug,
        is_live_fetch: bot.live ?? false,
        referer: req.headers.get('referer')?.slice(0, 500) ?? null,
      }),
    }).catch(() => {})
  } catch {
    // Never let logging affect the response.
  }

  return res
}

export const config = {
  // Only pages worth measuring — skip static assets and internals.
  matcher: [
    '/',
    '/news/:path*',
    '/lane/:path*',
    '/intelligence',
    '/llms.txt',
  ],
}
