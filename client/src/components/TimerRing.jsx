import Icon from './Icon'

// Circular countdown ring for the live auction. Shows remaining seconds and
// depletes / changes color as time runs out to create urgency.
export default function TimerRing({ seconds, total, paused = false, size = 96 }) {
  const stroke = 7
  const r = (size - stroke) / 2 - 1
  const circ = 2 * Math.PI * r
  const safeTotal = Number(total) > 0 ? Number(total) : 1
  const frac = Math.max(0, Math.min(1, seconds / safeTotal))

  const danger = seconds <= 5
  const warn = !danger && frac <= 0.4
  const color = danger ? '#fb7185' : warn ? '#ffaf54' : '#4dd5a3'
  const center = size / 2

  return (
    <div
      className={`relative inline-flex items-center justify-center ${danger && !paused ? 'animate-pulse' : ''}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={center} cy={center} r={r} fill="none" stroke="rgba(147,190,235,0.14)" strokeWidth={stroke} />
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {paused ? (
          <Icon name="pause" size={size * 0.34} strokeWidth={2.4} style={{ color }} />
        ) : (
          <span className="font-black tabular-nums" style={{ color, fontSize: size * 0.34 }}>
            {Math.max(0, Math.ceil(seconds))}
          </span>
        )}
      </div>
    </div>
  )
}
