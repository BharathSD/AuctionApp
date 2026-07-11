import { useState } from 'react'
import PlayerAvatar from './PlayerAvatar'

function isSafePhotoUrl(url) {
  if (!url) return false
  const trimmed = String(url).trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// Large "featured lot" portrait for the live console. Falls back to the big
// initials avatar when no valid photo is available (or the image fails to load).
export default function PlayerSpotlight({ name, photoUrl, tag = 'On the block' }) {
  const [failed, setFailed] = useState(false)
  const canRenderImage = isSafePhotoUrl(photoUrl) && !failed

  if (!canRenderImage) {
    return <PlayerAvatar name={name} photoUrl={null} size="3xl" />
  }

  return (
    <div className="relative w-full max-w-xs mx-auto">
      <span className="absolute top-3 left-3 z-10 pill-static !text-[0.6rem] !px-2.5 !py-1">{tag}</span>
      <span className="absolute top-3 right-3 z-10 pill-live !text-[0.6rem] !px-2.5 !py-1">
        <span className="live-dot" /> Live
      </span>
      <img
        src={String(photoUrl).trim()}
        alt={name ? `${name} photo` : 'Player photo'}
        onError={() => setFailed(true)}
        loading="lazy"
        className="w-full h-80 object-cover rounded-2xl border border-white/10 shadow-2xl bg-gray-800"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-2xl bg-gradient-to-t from-black/70 to-transparent" />
    </div>
  )
}
