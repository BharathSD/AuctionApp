import { useMemo, useState } from 'react'
import { proxiedImg } from '../utils/img'

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
    xs: 'w-7 h-7 text-[11px]',
    sm: 'w-10 h-10 text-sm',
    md: 'w-12 h-12 text-base',
    lg: 'w-16 h-16 text-lg',
    xl: 'w-24 h-24 text-2xl',
    '2xl': 'w-32 h-32 text-3xl',
    '3xl': 'w-40 h-40 text-4xl',
    '4xl': 'w-48 h-48 text-5xl',
  }

  const canRenderImage = isSafePhotoUrl(photoUrl) && !imageFailed
  const circleClasses = `${sizeClasses[size] || sizeClasses.md} rounded-full overflow-hidden shrink-0`

  if (canRenderImage) {
    return (
      <img
        src={proxiedImg(String(photoUrl).trim())}
        alt={name ? `${name} photo` : 'Player photo'}
        className={`${circleClasses} object-cover ${className}`}
        loading="lazy"
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
