import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadAuctionState, saveAuctionConfig, saveOnlineLiveSnapshot, clearAuctionState } from '../hooks/useAuctionStorage'
import BrandMark from '../components/BrandMark'
import Icon from '../components/Icon'

const TICKER = [
  'Real-time bidding', 'CSV player import', 'Retentions & pre-allocation',
  'Live broadcast board', 'XLSX results export', 'Offline & online modes',
  'Custom bid tiers', 'Auto-assign unsold',
]

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
    <div className="app-shell min-h-screen text-white flex flex-col">
      {/* Top bar */}
      <header className="landing-topbar">
        <BrandMark size={34} withWordmark wordmark="Auction OS" />
        <span className="pill-live"><span className="live-dot" /> Live tournament ops</span>
      </header>

      {/* Feature ticker */}
      <div className="feature-ticker">
        <div className="feature-ticker-track">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="ticker-item"><span className="ticker-dot" />{t}</span>
          ))}
        </div>
      </div>

      <div className="app-page w-full max-w-6xl px-6 py-10 md:py-14 flex-1">
        {/* Resume in-progress offline auction */}
        {offlineInProgress && (
          <div className="status-banner w-full mb-8 px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-yellow-100 font-semibold text-sm flex items-center gap-1.5"><Icon name="bolt" size={15} /> Offline auction in progress</p>
              <p className="text-yellow-200 text-xs mt-0.5">
                {saved._runtime.status === 'sold' || saved._runtime.status === 'running'
                  ? `Player ${saved._runtime.currentIdx + 1} of ${saved._runtime.queue?.length ?? '?'} — ${saved._runtime.status}`
                  : saved._runtime.status}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => navigate('/auction/offline')} className="btn-primary text-sm px-4 py-2">Resume →</button>
              <button
                onClick={() => { if (window.confirm('Discard the in-progress auction and start fresh?')) { clearAuctionState(); window.location.reload() } }}
                className="btn-secondary text-xs px-3 py-2"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {/* Editorial hero */}
        <section className="grid lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-14 items-center">
          {/* Left */}
          <div className="text-left">
            <span className="pill-live"><span className="live-dot" /> Marquee auction · Tournament ops</span>
            <h1 className="display-heading mt-6">
              <span className="block text-white">Cricket Auction</span>
              <span className="block display-muted">Control Room</span>
            </h1>
            <p className="hero-subtext text-left mx-0 mt-6">
              Run your league like a live broadcast — fast setup, dramatic bidding, and instant, shareable results. Offline in one room, or online across everyone's devices.
            </p>

            <div className="flex flex-wrap gap-x-10 gap-y-5 mt-9">
              <div><p className="stat-label">Modes</p><p className="stat-value">Offline + Online</p></div>
              <div><p className="stat-label">Teams</p><p className="stat-value">Up to 16</p></div>
              <div><p className="stat-label">Bidding</p><p className="stat-value">Real-time</p></div>
            </div>

            <div className="flex flex-wrap gap-3 mt-9">
              <button onClick={() => navigate('/setup/offline')} className="btn-primary text-base px-7 py-3.5">Start offline auction →</button>
              <button onClick={() => navigate('/setup/online')} className="btn-secondary text-base px-7 py-3.5">Set up online →</button>
            </div>
          </div>

          {/* Right: mode showcase card */}
          <div className="showcase-card">
            <div className="flex items-center justify-between mb-5">
              <span className="tag">Choose your mode</span>
              <span className="pill-live"><span className="live-dot" /> Live</span>
            </div>

            <div className="flex flex-col gap-3">
              <button onClick={() => navigate('/setup/offline')} className="mode-row group">
                <div className="mode-row-icon"><Icon name="tv" size={20} /></div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-lg">Offline Mode</p>
                  <p className="text-sm text-blue-100/70">One screen or projector. Captains bid verbally. No internet needed.</p>
                </div>
                <span className="mode-row-arrow">→</span>
              </button>
              <button onClick={() => navigate('/setup/online')} className="mode-row group">
                <div className="mode-row-icon"><Icon name="bolt" size={20} /></div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-lg">Online Mode</p>
                  <p className="text-sm text-blue-100/70">Captains bid from their phones in real-time, across the internet.</p>
                </div>
                <span className="mode-row-arrow">→</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2.5 mt-5">
              <div className="cap-chip"><Icon name="bolt" size={16} /> Real-time</div>
              <div className="cap-chip"><Icon name="tv" size={16} /> Broadcast</div>
              <div className="cap-chip"><Icon name="download" size={16} /> XLSX export</div>
            </div>

            <div className="mt-5 pt-5 border-t border-white/5">
              <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleResumeFile} />
              <button onClick={() => fileRef.current?.click()} className="text-sm text-cyan-200/80 hover:text-white inline-flex items-center gap-2">
                <Icon name="upload" size={15} /> Resume a saved auction from a snapshot file →
              </button>
            </div>
          </div>
        </section>

        <p className="text-blue-300/60 text-xs mt-12">Cricket Auction App — Built for your league</p>
      </div>
    </div>
  )
}
