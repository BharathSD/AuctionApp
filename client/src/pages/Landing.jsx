import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveAuctionConfig, saveOnlineLiveSnapshot } from '../hooks/useAuctionStorage'

export default function Landing() {
  const navigate = useNavigate()
  const fileRef = useRef(null)

  const handleResumeFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      if (!data.roomCode || !data.snapshot || !data.originalSetup) {
        alert('Invalid snapshot file'); return
      }
      const r = await fetch('/api/auction/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: data.roomCode, snapshot: data.snapshot, originalSetup: data.originalSetup }),
      })
      if (!r.ok) throw new Error('Restore failed')
      saveAuctionConfig(data.originalSetup)
      saveOnlineLiveSnapshot({ roomCode: data.roomCode, state: data.snapshot, savedAt: Date.now() })
      navigate('/auction/online/admin')
    } catch (err) {
      alert('Failed to restore: ' + err.message)
    }
    e.target.value = ''
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-900 flex flex-col items-center justify-center p-6">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="text-6xl mb-4">🏏</div>
        <h1 className="text-5xl font-extrabold text-white tracking-tight mb-3">
          Cricket Auction
        </h1>
        <p className="text-blue-200 text-lg max-w-md">
          Run a live player auction for your cricket league — online or offline.
        </p>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl">
        <button
          onClick={() => navigate('/setup/offline')}
          className="group bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl p-8 text-left transition-all duration-200 hover:scale-105 cursor-pointer"
        >
          <div className="text-4xl mb-4">📺</div>
          <h2 className="text-2xl font-bold text-white mb-2">Offline Mode</h2>
          <p className="text-blue-200 text-sm leading-relaxed">
            Everyone is in the same room. Auctioneer controls a single screen
            or projector. No internet required. Captains bid verbally.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 text-blue-300 font-semibold text-sm group-hover:text-white transition-colors">
            Set up offline auction →
          </div>
        </button>

        <button
          onClick={() => navigate('/setup/online')}
          className="group bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl p-8 text-left transition-all duration-200 hover:scale-105 cursor-pointer"
        >
          <div className="text-4xl mb-4">📱</div>
          <h2 className="text-2xl font-bold text-white mb-2">Online Mode</h2>
          <p className="text-blue-200 text-sm leading-relaxed">
            Captains bid from their own phones or laptops in real-time.
            Works across the internet. Auctioneer controls via an admin screen.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 text-blue-300 font-semibold text-sm group-hover:text-white transition-colors">
            Set up online auction →
          </div>
        </button>
      </div>

      <p className="text-blue-400 text-xs mt-10">
        Cricket Auction App — Built for your league
      </p>

      {/* Resume from snapshot */}
      <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleResumeFile} />
      <button
        onClick={() => fileRef.current?.click()}
        className="mt-4 text-blue-400 hover:text-white text-xs underline underline-offset-2 transition-colors"
      >
        Resume saved auction from snapshot file →
      </button>
    </div>
  )
}
