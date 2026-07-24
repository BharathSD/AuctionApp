import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

export default function CaptainJoin() {
  const { roomCode } = useParams()
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleJoin = async () => {
    setError('')
    if (!pin.trim()) { setError('Enter your PIN'); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/auction/${roomCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409) {
          setError('This team is already connected on another device. Ask the auctioneer to kick that session or wait for reconnect grace period.')
        } else if (res.status === 401) {
          setError(data.error || 'Invalid PIN')
        } else {
          setError(data.error || 'Could not join room right now. Please try again.')
        }
        setLoading(false)
        return
      }
      // Store captain identity in sessionStorage (per-tab, not shared)
      sessionStorage.setItem('captain_roomCode', roomCode)
      sessionStorage.setItem('captain_teamId', data.teamId)
      sessionStorage.setItem('captain_teamName', data.teamName)
      sessionStorage.setItem('captain_token', data.captainToken)
      sessionStorage.setItem('captain_engine', data.engine || 'bidding')
      navigate('/auction/online/captain')
    } catch {
      setError('Could not reach server. Is the auction running?')
      setLoading(false)
    }
  }

  return (
    <div className="app-shell flex items-center justify-center p-6 text-white">
      <div className="premium-hero w-full max-w-md text-center p-8 md:p-9">
        <p className="hero-kicker mb-2">Captain Access</p>
        <h1 className="hero-heading text-white mb-2" style={{ fontSize: 'clamp(2rem, 7vw, 3rem)' }}>Join Auction</h1>
        <p className="text-blue-100 text-sm mb-6">
          Room: <span className="font-mono font-bold text-yellow-400">{roomCode}</span>
        </p>

        <div className="text-left mb-4">
          <label className="block text-sm text-blue-100 mb-2 font-semibold">Your team PIN</label>
          <input
            type="text"
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
            placeholder="Enter PIN"
            className="input-field w-full text-center text-xl font-mono tracking-widest"
            maxLength={8}
            autoFocus
          />
        </div>

        {error && <p className="text-red-200 text-sm mb-4 font-medium">{error}</p>}

        <button
          onClick={handleJoin}
          disabled={loading}
          className="btn-primary w-full py-3 text-lg disabled:opacity-50"
        >
          {loading ? 'Joining…' : 'Join Auction'}
        </button>

        <p className="text-xs text-blue-200/80 mt-4">Secure captain session. One active device per team.</p>
      </div>
    </div>
  )
}
