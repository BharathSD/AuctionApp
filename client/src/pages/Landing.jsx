import { useNavigate } from 'react-router-dom'

export default function Landing() {
  const navigate = useNavigate()

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
    </div>
  )
}
