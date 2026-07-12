// Route external image URLs through this app's own server (/api/img-proxy) so
// every viewing device can load them regardless of the source host's
// CORS / ORB / redirect / firewall behavior. Local/relative or data URLs pass through.
export function proxiedImg(url) {
  if (!url) return url
  const trimmed = String(url).trim()
  if (!/^https?:\/\//i.test(trimmed)) return trimmed
  return `/api/img-proxy?url=${encodeURIComponent(trimmed)}`
}
