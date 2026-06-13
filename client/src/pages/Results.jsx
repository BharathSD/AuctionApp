import { useNavigate } from 'react-router-dom'
import { loadAuctionState, clearAuctionState } from '../hooks/useAuctionStorage'

export default function Results() {
  const navigate = useNavigate()
  const saved = loadAuctionState()

  if (!saved) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">No auction data found.</p>
          <button onClick={() => navigate('/')} className="btn-primary">Go Home</button>
        </div>
        <style>{`.btn-primary{background:#2563eb;color:white;padding:.5rem 1.25rem;border-radius:.75rem;font-weight:600;cursor:pointer}`}</style>
      </div>
    )
  }

  const { teams, players, config, mode } = saved
  const soldPlayers = players.filter(p => p.status === 'sold')
  const unsoldPlayers = players.filter(p => p.status !== 'sold')

  // Build bid history from all teams' players
  const allBids = players
    .filter(p => p.status === 'sold')
    .map(p => ({ player: p.name, role: p.role, team: teams.find(t => t.id === p.soldTo)?.name || '?', price: p.soldPrice }))

  const exportCSV = () => {
    const rows = [
      ['Player', 'Role', 'Team', 'Sold Price'],
      ...allBids.map(b => [b.player, b.role, b.team, b.price]),
    ]
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'auction-results.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleNewAuction = () => {
    clearAuctionState()
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">🏆</div>
          <h1 className="text-3xl font-extrabold mb-1">Auction Results</h1>
          <p className="text-gray-400 text-sm">
            {soldPlayers.length} of {players.length} players sold · {mode === 'offline' ? 'Offline' : 'Online'} auction
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <StatCard label="Total Players" value={players.length} />
          <StatCard label="Sold" value={soldPlayers.length} color="text-green-400" />
          <StatCard label="Unsold" value={unsoldPlayers.length} color="text-red-400" />
          <StatCard label="Points spent" value={soldPlayers.reduce((s, p) => s + p.soldPrice, 0)} color="text-yellow-400" />
        </div>

        {/* Team rosters */}
        <div className="mb-10">
          <h2 className="text-xl font-bold mb-4">Team Rosters</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {teams.map(team => {
              const roster = players.filter(p => p.status === 'sold' && p.soldTo === team.id)
              const pct = Math.round((team.budget / config.pointsPerTeam) * 100)
              return (
                <div key={team.id} className="bg-gray-900 rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 bg-gray-800 flex justify-between items-center">
                    <h3 className="font-bold">{team.name}</h3>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Budget left</p>
                      <p className="text-yellow-400 font-bold">{team.budget} pts</p>
                    </div>
                  </div>
                  <div className="px-4 py-1">
                    <div className="w-full bg-gray-700 rounded-full h-1.5 my-2">
                      <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  {roster.length === 0 ? (
                    <p className="px-4 py-3 text-gray-600 text-sm">No players acquired</p>
                  ) : (
                    <div className="divide-y divide-gray-800">
                      {roster.map((p, i) => (
                        <div key={i} className="px-4 py-2.5 flex justify-between items-center">
                          <div>
                            <p className="text-sm font-medium">{p.name}</p>
                            <p className="text-xs text-gray-500">{p.role}</p>
                          </div>
                          <p className="text-yellow-400 font-bold text-sm">{p.soldPrice} pts</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Unsold players */}
        {unsoldPlayers.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xl font-bold mb-4">Unsold Players</h2>
            <div className="bg-gray-900 rounded-2xl divide-y divide-gray-800">
              {unsoldPlayers.map((p, i) => (
                <div key={i} className="px-4 py-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-gray-500">{p.role}</p>
                  </div>
                  <p className="text-gray-500 text-sm">Base: {p.basePrice} pts</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-4 justify-center">
          <button onClick={exportCSV} className="btn-secondary flex items-center gap-2">
            📥 Export CSV
          </button>
          <button onClick={handleNewAuction} className="btn-primary">
            🏏 New Auction
          </button>
        </div>
      </div>

      <style>{`
        .btn-primary { background: #2563eb; color: white; padding: 0.5rem 1.5rem; border-radius: 0.75rem; font-weight: 600; cursor: pointer; }
        .btn-primary:hover { background: #1d4ed8; }
        .btn-secondary { background: #374151; color: white; padding: 0.5rem 1.5rem; border-radius: 0.75rem; font-weight: 600; cursor: pointer; }
        .btn-secondary:hover { background: #4b5563; }
      `}</style>
    </div>
  )
}

function StatCard({ label, value, color = 'text-white' }) {
  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
