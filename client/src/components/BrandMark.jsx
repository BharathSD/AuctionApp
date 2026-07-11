// Brand mark for the Cricket Auction app. Emblem = auction paddle over a pitch,
// rendered as a self-contained gradient SVG so it works offline.
export default function BrandMark({ size = 40, withWordmark = false, wordmark = 'Auction OS', className = '' }) {
  const gid = 'bm-grad'
  return (
    <span className={`brand-mark ${className}`}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3eb6ff" />
            <stop offset="0.55" stopColor="#2f87f5" />
            <stop offset="1" stopColor="#4dd5a3" />
          </linearGradient>
        </defs>
        <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill={`url(#${gid})`} />
        <rect x="1.5" y="1.5" width="45" height="45" rx="12" stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" />
        {/* auction gavel */}
        <g stroke="#08111f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 17l8 8" />
          <rect x="14.5" y="12" width="9.5" height="6.2" rx="1.6" transform="rotate(45 19.25 15.1)" fill="#08111f" stroke="none" />
          <path d="M24.5 24.5L33 33" />
        </g>
        {/* sound block / base */}
        <rect x="27" y="33.5" width="14" height="3.6" rx="1.8" fill="#08111f" />
      </svg>
      {withWordmark && <span className="brand-wordmark" style={{ fontSize: size * 0.42 }}>{wordmark}</span>}
    </span>
  )
}
