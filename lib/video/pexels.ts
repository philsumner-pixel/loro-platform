// Pexels b-roll — portrait photos only (reliable, Ken Burns friendly).

const FALLBACK_QUERY = 'modern fintech office'

export async function searchPhoto(query: string): Promise<string> {
  for (const q of [query, FALLBACK_QUERY]) {
    if (!q) continue
    try {
      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=1&orientation=portrait`,
        { headers: { Authorization: process.env.PEXELS_API_KEY! } }
      )
      if (res.ok) {
        const data = await res.json()
        const photo = data.photos?.[0]
        if (photo?.src?.large2x) return photo.src.large2x
      }
    } catch (e) {
      console.warn('Pexels search failed for', q, e)
    }
  }
  return ''
}

// Source one photo per query, in parallel.
export async function sourcePhotos(queries: string[]): Promise<string[]> {
  return Promise.all(queries.map(q => searchPhoto(q)))
}
