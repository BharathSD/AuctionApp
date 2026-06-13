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
      if (!res.ok) { setError(data.error || 'Invalid PIN'); setLoading(false); return }
      // Store captain identity in sessionStorage (per-tab, not shared)
      sessionStorage.setItem('captain_roomCode', roomCode)
      sessionStorage.setItem('captain_teamId', data.teamId)
      sessionStorage.setItem('captain_teamName', data.teamName)
      navigate('/auction/online/captain')
    } catch {
      setError('Could not reach server. Is the auction running?')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-900 flex items-center justify-center p-6">
      <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-8 w-full max-w-sm text-white text-center">
        <div className="text-5xl mb-4">🏏</div>
        <h1 className="text-2xl font-bold mb-1">Join Auction</h1>
        <p className="text-blue-200 text-sm mb-6">
          Room: <span className="font-mono font-bold text-yellow-400">{roomCode}</span>
        </p>

        <div className="text-left mb-4">
          <label className="block text-sm text-blue-200 mb-2">Your team PIN</label>
          <input
            type="text"
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
            placeholder="Enter PIN"
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-blue-300 text-center text-xl font-mono tracking-widest outline-none focus:border-blue-400"
            maxLength={8}
            autoFocus
          />
        </div>

        {error && <p className="text-red-300 text-sm mb-4">{error}</p>}

        <button
          onClick={handleJoin}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-lg transition-colors"
        >
          {loading ? 'Joining…' : 'Join Auction'}
        </button>
      </div>
    </div>
  )
}
