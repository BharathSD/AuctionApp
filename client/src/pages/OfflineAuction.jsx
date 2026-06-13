import { useNavigate } from 'react-router-dom'
import { useOfflineAuction } from '../hooks/useOfflineAuction'
import { loadAuctionState } from '../hooks/useAuctionStorage'

const ROLE_COLORS = {
  Batsman: 'bg-blue-700',
  Bowler: 'bg-green-700',
  'All-rounder': 'bg-purple-700',
  'Wicket-keeper': 'bg-orange-700',
}

export default function OfflineAuction() {
  const navigate = useNavigate()
  const saved = loadAuctionState()
  const {
    state, currentPlayer, leadingTeam,
    startAuction, recordBid, undoBid, markSold, markUnsold, nextPlayer, pause, resume, requeueUnsold, finishAuction,
  } = useOfflineAuction()

  if (!saved) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">No auction configured.</p>
          <button onClick={() => navigate('/setup/offline')} className="btn-primary">Set up auction</button>
        </div>
      </div>
    )
  }

  const { status, teams, bids, timerLeft, paused, config } = state
  const soldCount = state.players.filter(p => p.status === 'sold').length
  const totalPlayers = state.players.length
  const queueLeft = state.queue.length - state.currentIdx - 1

  if (status === 'finished') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-6 p-6">
        <div className="text-6xl">🏆</div>
        <h2 className="text-3xl font-bold">Auction Complete!</h2>
        <p className="text-gray-400">{soldCount} of {totalPlayers} players sold</p>
        <div className="flex gap-4">
          {state.players.some(p => p.status === 'unsold') && (
            <button onClick={requeueUnsold} className="btn-secondary">Re-auction unsold players</button>
          )}
          <button onClick={() => navigate('/results')} className="btn-primary">View Results →</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col" style={{ minHeight: '100dvh' }}>
      {/* Top bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-bold text-lg">🏏 Auction</span>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">OFFLINE</span>
          {state.secondRound && (
            <span className="text-xs bg-orange-700 text-orange-100 px-2 py-1 rounded font-semibold">🔁 Unsold Round</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>{soldCount}/{totalPlayers} sold</span>
          <span>{queueLeft} in queue</span>
          {status !== 'idle' && !paused && (
            <button onClick={pause} className="text-yellow-400 hover:text-yellow-300 text-xs border border-yellow-700 px-2 py-1 rounded">⏸ Pause</button>
          )}
          {paused && (
            <button onClick={resume} className="text-green-400 hover:text-green-300 text-xs border border-green-700 px-2 py-1 rounded">▶ Resume</button>
          )}
          {status !== 'idle' && status !== 'finished' && (
            <button
              onClick={() => { if (window.confirm('End the auction now? Remaining players will be skipped.')) finishAuction() }}
              className="text-red-400 hover:text-red-300 text-xs border border-red-800 px-2 py-1 rounded"
            >
              ⏹ Finish
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel: Current player + controls ── */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          {status === 'idle' && (
            <div className="text-center">
              <p className="text-gray-400 mb-6 text-lg">Ready to start the auction</p>
              <button onClick={startAuction} className="btn-primary text-xl px-10 py-4">
                🚀 Start Auction
              </button>
            </div>
          )}

          {(status === 'running' || status === 'sold' || status === 'unsold') && currentPlayer && (
            <>
              {/* Player card */}
              <div className="bg-gray-800 rounded-3xl p-8 text-center w-full max-w-sm shadow-2xl border border-gray-700">
                <div className={`inline-block px-3 py-1 rounded-full text-xs font-bold mb-4 ${ROLE_COLORS[currentPlayer.role] || 'bg-gray-700'}`}>
                  {currentPlayer.role}
                </div>
                <h2 className="text-4xl font-extrabold mb-2">{currentPlayer.name}</h2>
                <p className="text-gray-400 text-sm mb-6">Base: {currentPlayer.basePrice} pts</p>

                {/* Current bid */}
                <div className="bg-gray-900 rounded-2xl p-4 mb-4">
                  <p className="text-xs text-gray-500 mb-1">Current Bid</p>
                  <p className="text-5xl font-black text-yellow-400">{state.currentPrice}</p>
                  {leadingTeam && (
                    <p className="text-sm text-blue-300 mt-2 font-semibold">🔥 {leadingTeam.name}</p>
                  )}
                  {!leadingTeam && status === 'running' && (
                    <p className="text-sm text-gray-500 mt-2">No bids yet</p>
                  )}
                </div>

                {/* Timer */}
                {config.timerEnabled && status === 'running' && (
                  <div className={`text-4xl font-bold ${timerLeft <= 5 ? 'text-red-400 animate-pulse' : 'text-gray-300'}`}>
                    {paused ? '⏸' : `${timerLeft}s`}
                  </div>
                )}

                {/* Status badges */}
                {status === 'sold' && (
                  <div className="mt-4 bg-green-800 rounded-xl px-4 py-2 text-green-200 font-bold text-lg">
                    ✅ SOLD to {leadingTeam?.name}
                  </div>
                )}
                {status === 'unsold' && (
                  <div className="mt-4 bg-red-900 rounded-xl px-4 py-2 text-red-200 font-bold text-lg">
                    ❌ UNSOLD
                  </div>
                )}
              </div>

              {/* Auctioneer controls */}
              {status === 'running' && (
                <div className="w-full max-w-sm space-y-3">
                  {/* Bid buttons per team */}
                  <p className="text-xs text-gray-500 text-center uppercase tracking-widest">Click when team bids</p>
                  <div className="grid grid-cols-2 gap-3">
                    {teams.map(team => {
                      const canBid = team.budget >= state.currentPrice + config.bidIncrement
                        && !paused
                        && state.leadingTeamId !== team.id
                      return (
                        <button
                          key={team.id}
                          onClick={() => recordBid(team.id)}
                          disabled={!canBid}
                          className={`rounded-xl py-3 px-4 font-bold text-sm transition-all ${
                            canBid
                              ? 'bg-gray-700 hover:bg-gray-600 text-white'
                              : state.leadingTeamId === team.id
                                ? 'bg-blue-900 text-blue-300 cursor-not-allowed ring-2 ring-blue-500'
                                : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                          }`}
                        >
                          <span className="block truncate">{team.name}</span>
                          <span className="block text-xs font-normal mt-1 opacity-70">
                            {state.leadingTeamId === team.id ? '🔥 Leading' : `${team.budget} pts left`}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  {/* Sold / Unsold / Undo */}
                  <div className="grid grid-cols-3 gap-3 mt-2">
                    <button
                      onClick={markSold}
                      disabled={!leadingTeam}
                      className="bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl py-3 font-bold"
                    >
                      ✅ Sold
                    </button>
                    <button
                      onClick={markUnsold}
                      className="bg-red-800 hover:bg-red-700 text-white rounded-xl py-3 font-bold"
                    >
                      ❌ Unsold
                    </button>
                    <button
                      onClick={undoBid}
                      disabled={!bids.length}
                      className="bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl py-3 font-bold text-sm"
                    >
                      ↩ Undo
                    </button>
                  </div>
                </div>
              )}

              {(status === 'sold' || status === 'unsold') && (
                <button onClick={nextPlayer} className="btn-primary text-lg px-8 py-3">
                  Next Player →
                </button>
              )}
            </>
          )}
        </div>

        {/* ── Right panel: Teams & Bid log ── */}
        <div className="w-72 bg-gray-900 border-l border-gray-800 flex flex-col" style={{height: 'calc(100vh - 57px)'}}>
          {/* Teams — always fully visible */}
          <div className="p-4 border-b border-gray-800 shrink-0">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Teams</p>
            <div className="space-y-2">
              {teams.map(team => {
                const pct = Math.round((team.budget / saved.config.pointsPerTeam) * 100)
                return (
                  <div key={team.id} className={`rounded-lg p-2 ${state.leadingTeamId === team.id ? 'bg-blue-900/60 ring-1 ring-blue-500' : 'bg-gray-800'}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium truncate">{team.name}</span>
                      <span className="text-xs text-yellow-400 font-bold">{team.budget}</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-1.5">
                      <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{team.players.length} players</p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Bid log — takes remaining space, always scrollable */}
          <div className="flex-1 p-4 overflow-y-auto min-h-0">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Bid Log</p>
            {currentPlayer && (
              <p className="text-xs text-blue-400 font-medium mb-3 truncate">{currentPlayer.name}</p>
            )}
            {bids.length === 0 && <p className="text-xs text-gray-600">No bids yet</p>}
            <div className="space-y-1">
              {bids.slice(0, 30).map((b, i) => {
                const team = teams.find(t => t.id === b.teamId)
                return (
                  <div key={i} className="text-xs flex justify-between text-gray-400">
                    <span className="truncate">{team?.name}</span>
                    <span className="text-yellow-400 font-mono">{b.price}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .btn-primary { background: #2563eb; color: white; padding: 0.5rem 1.25rem; border-radius: 0.75rem; font-weight: 600; font-size: 0.875rem; cursor: pointer; }
        .btn-primary:hover { background: #1d4ed8; }
        .btn-secondary { background: #374151; color: white; padding: 0.5rem 1.25rem; border-radius: 0.75rem; font-weight: 600; font-size: 0.875rem; cursor: pointer; }
      `}</style>
    </div>
  )
}
