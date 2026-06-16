import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadAuctionState, saveAuctionConfig, saveOnlineLiveSnapshot, clearAuctionState } from '../hooks/useAuctionStorage'

export default function Landing() {
  const navigate = useNavigate()
  const fileRef = useRef(null)

  // Detect in-progress offline auction
  const saved = loadAuctionState()
  const offlineInProgress = saved && !saved.roomCode && saved._runtime &&
    saved._runtime.status !== 'finished' && saved._runtime.status !== 'idle'

  const handleResumeFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      const snapshot = data.snapshot || data.state
      if (!data.roomCode || !snapshot || !data.originalSetup) {
        alert('Invalid snapshot file'); return
      }
      const r = await fetch('/api/auction/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: data.roomCode, snapshot, originalSetup: data.originalSetup }),
      })
      if (!r.ok) throw new Error('Restore failed')
      saveAuctionConfig(data.originalSetup)
      saveOnlineLiveSnapshot({ roomCode: data.roomCode, state: snapshot, savedAt: Date.now() })
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

      {/* Resume in-progress offline auction */}
      {offlineInProgress && (
        <div className="w-full max-w-2xl mb-6 bg-yellow-900/60 border border-yellow-600 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-yellow-200 font-semibold text-sm">⚡ Offline auction in progress</p>
            <p className="text-yellow-400 text-xs mt-0.5">
              {saved._runtime.status === 'sold' || saved._runtime.status === 'running'
                ? `Player ${saved._runtime.currentIdx + 1} of ${saved._runtime.queue?.length ?? '?'} — ${saved._runtime.status}`
                : saved._runtime.status}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => navigate('/auction/offline')}
              className="bg-yellow-500 hover:bg-yellow-400 text-gray-900 font-bold text-sm px-4 py-2 rounded-xl"
            >
              Resume →
            </button>
            <button
              onClick={() => { if (window.confirm('Discard the in-progress auction and start fresh?')) { clearAuctionState(); window.location.reload() } }}
              className="text-yellow-500 hover:text-white text-xs border border-yellow-700 px-3 py-2 rounded-xl"
            >
              Discard
            </button>
          </div>
        </div>
      )}

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
        className="mt-6 px-6 py-3 bg-blue-700 hover:bg-blue-600 text-white font-semibold text-base rounded-xl border border-blue-500 transition-colors shadow-md"
      >
        💾 Resume saved auction from snapshot file →
      </button>
    </div>
  )
}
