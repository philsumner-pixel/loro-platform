interface SponsorTagProps {
  name?: string
  url?: string
}

// Renders nothing when no sponsor is set — zero footprint until a deal is in place
export default function SponsorTag({ name, url }: SponsorTagProps) {
  if (!name) return null

  return (
    <span className="loro-sponsor-tag">
      Supported by{' '}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener sponsored"
          className="loro-sponsor-name"
        >
          {name}
        </a>
      ) : (
        <span className="loro-sponsor-name">{name}</span>
      )}
    </span>
  )
}
