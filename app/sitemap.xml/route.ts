import { NextResponse } from 'next/server'

// Static entries — update as new pages are added
// When articles are in the DB this will be generated dynamically
const STATIC_PAGES = [
  { url: '/', priority: '1.0', changefreq: 'hourly' },
  { url: '/brand-identity', priority: '0.3', changefreq: 'monthly' },
  { url: '/newsroom', priority: '0.2', changefreq: 'daily' },
  { url: '/news/paypal-eu-pdmr-disclosure', priority: '0.9', changefreq: 'weekly' },
]

export async function GET() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://loro-platform.vercel.app'
  const now = new Date().toISOString()

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${STATIC_PAGES.map(p => `  <url>
    <loc>${base}${p.url}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
}
