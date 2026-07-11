// Route external image URLs through the server proxy so they load reliably
// regardless of the source host's CORS / ORB / redirect behavior.
// Local/relative or data URLs are returned unchanged.
export function proxiedImg(url) {
  if (!url) return url
  const trimmed = String(url).trim()
  if (!/^https?:\/\//i.test(trimmed)) return trimmed
  return `/api/img-proxy?url=${encodeURIComponent(trimmed)}`
}
