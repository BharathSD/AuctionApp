import { useMemo, useState } from 'react'

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'PL'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

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

export default function PlayerAvatar({ name, photoUrl, size = 'md', className = '' }) {
  const [imageFailed, setImageFailed] = useState(false)
  const initials = useMemo(() => getInitials(name), [name])

  const sizeClasses = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-base',
    xl: 'w-20 h-20 text-xl',
    '2xl': 'w-28 h-28 text-2xl',
    '3xl': 'w-36 h-36 text-3xl',
  }

  const canRenderImage = isSafePhotoUrl(photoUrl) && !imageFailed
  const circleClasses = `${sizeClasses[size] || sizeClasses.md} rounded-full overflow-hidden shrink-0`

  if (canRenderImage) {
    return (
      <img
        src={String(photoUrl).trim()}
        alt={name ? `${name} photo` : 'Player photo'}
        className={`${circleClasses} object-cover ${className}`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setImageFailed(true)}
      />
    )
  }

  return (
    <div className={`${circleClasses} bg-gray-700 text-gray-200 font-bold flex items-center justify-center ${className}`}>
      {initials}
    </div>
  )
}
