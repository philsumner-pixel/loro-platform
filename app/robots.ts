import type { MetadataRoute } from 'next'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://loro-platform.vercel.app'

// AI crawlers are explicitly welcomed. Being cited in generated answers is a
// deliberate distribution channel for Loro, not an accident to be defended
// against — a new domain can win citation share on content quality without
// first climbing a decade of search rankings.
export default function robots(): MetadataRoute.Robots {
  const aiCrawlers = [
    'GPTBot',          // OpenAI index
    'OAI-SearchBot',   // ChatGPT search
    'ChatGPT-User',    // user-triggered live fetch
    'ClaudeBot',
    'Claude-User',
    'PerplexityBot',
    'Perplexity-User',
    'Google-Extended', // Gemini
    'Applebot-Extended',
    'Amazonbot',
    'Bytespider',
    'CCBot',
  ]

  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/newsroom', '/api/'] },
      ...aiCrawlers.map(userAgent => ({
        userAgent,
        allow: '/',
        disallow: ['/newsroom', '/api/'],
      })),
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  }
}
