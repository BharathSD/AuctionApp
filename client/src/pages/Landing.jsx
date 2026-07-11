import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadAuctionState, saveAuctionConfig, saveOnlineLiveSnapshot, clearAuctionState } from '../hooks/useAuctionStorage'
import BrandMark from '../components/BrandMark'
import Icon from '../components/Icon'

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
        body: JSON.stringify({ roomCode: data.roomCode, snapshot, originalSetup: data.originalSetup, adminToken: data.originalSetup?.adminToken }),
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
    <div className="app-shell flex flex-col items-center justify-center p-6 text-white">
      <div className="app-page w-full max-w-6xl">
        <div className="premium-hero text-center px-6 py-8 md:py-10 mb-8">
          <div className="flex justify-center mb-4">
            <BrandMark size={52} withWordmark wordmark="Auction OS" />
          </div>
          <p className="hero-kicker mb-2">Tournament Ops Suite</p>
          <h1 className="hero-heading text-white mb-3">
            Cricket Auction Control Room
          </h1>
          <p className="hero-subtext">
            Professional live-auction experience for leagues that need speed, clarity, and drama on every bid.
          </p>
        </div>

      {/* Resume in-progress offline auction */}
      {offlineInProgress && (
        <div className="status-banner w-full mb-6 px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-yellow-100 font-semibold text-sm flex items-center gap-1.5"><Icon name="bolt" size={15} /> Offline auction in progress</p>
            <p className="text-yellow-200 text-xs mt-0.5">
              {saved._runtime.status === 'sold' || saved._runtime.status === 'running'
                ? `Player ${saved._runtime.currentIdx + 1} of ${saved._runtime.queue?.length ?? '?'} — ${saved._runtime.status}`
                : saved._runtime.status}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => navigate('/auction/offline')}
              className="btn-primary text-sm px-4 py-2"
            >
              Resume →
            </button>
            <button
              onClick={() => { if (window.confirm('Discard the in-progress auction and start fresh?')) { clearAuctionState(); window.location.reload() } }}
              className="btn-secondary text-xs px-3 py-2"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Mode cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
        <button
          onClick={() => navigate('/setup/offline')}
          className="feature-tile group p-8 text-left transition-all duration-200 hover:scale-[1.015] cursor-pointer"
        >
          <p className="hero-kicker mb-3">Single-Console</p>
          <h2 className="text-3xl font-bold text-white mb-2">Offline Mode</h2>
          <p className="text-blue-100 text-sm leading-relaxed">
            Everyone is in the same room. Auctioneer controls a single screen
            or projector. No internet required. Captains bid verbally.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 text-cyan-200 font-semibold text-sm group-hover:text-white transition-colors">
            Set up offline auction →
          </div>
        </button>

        <button
          onClick={() => navigate('/setup/online')}
          className="feature-tile group p-8 text-left transition-all duration-200 hover:scale-[1.015] cursor-pointer"
        >
          <p className="hero-kicker mb-3">Multi-Device</p>
          <h2 className="text-3xl font-bold text-white mb-2">Online Mode</h2>
          <p className="text-blue-100 text-sm leading-relaxed">
            Captains bid from their own phones or laptops in real-time.
            Works across the internet. Auctioneer controls via an admin screen.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 text-cyan-200 font-semibold text-sm group-hover:text-white transition-colors">
            Set up online auction →
          </div>
        </button>
      </div>

      <p className="text-blue-300 text-xs mt-10 text-center">
        Cricket Auction App — Built for your league
      </p>

      {/* Resume from snapshot */}
      <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleResumeFile} />
      <button
        onClick={() => fileRef.current?.click()}
        className="btn-secondary mt-6 px-6 py-3 text-base inline-flex items-center gap-2"
      >
        <Icon name="upload" size={16} /> Resume saved auction from snapshot file →
      </button>
      </div>
    </div>
  )
}
