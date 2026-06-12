// Creatomate render submission + status polling.

export interface RenderJob {
  id: string
  status: string
  url?: string | null
}

export async function submitRender(source: object): Promise<RenderJob> {
  const res = await fetch('https://api.creatomate.com/v1/renders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Creatomate error: ${res.status} — ${errText}`)
  }
  const data = await res.json()
  const job = Array.isArray(data) ? data[0] : data
  return { id: job.id, status: job.status, url: job.url ?? null }
}

export async function getRenderStatus(jobId: string): Promise<RenderJob> {
  const res = await fetch(`https://api.creatomate.com/v1/renders/${jobId}`, {
    headers: { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
  })
  if (!res.ok) throw new Error(`Creatomate status error: ${res.status}`)
  const job = await res.json()
  return { id: job.id, status: job.status, url: job.url ?? null }
}
