import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOfflineAuction } from '../hooks/useOfflineAuction'
import { loadAuctionState } from '../hooks/useAuctionStorage'
import { getIncrement } from '../utils/bidTiers'
import PlayerAvatar from '../components/PlayerAvatar'

const ROLE_COLORS = {
  Batsman: 'bg-blue-700',
  Bowler: 'bg-green-700',
  'All-rounder': 'bg-purple-700',
  'Wicket-keeper': 'bg-orange-700',
}

export default function OfflineAuction() {
  const navigate = useNavigate()
  const saved = loadAuctionState()
  const [expandedTeamId, setExpandedTeamId] = useState(null)
  const {
    state, currentPlayer, leadingTeam,
    startAuction, recordBid, undoBid, markSold, reopenSold, soldToUnsold, returnSoldToQueue, markUnsold, nextPlayer, pause, resume, requeueUnsold, finishAuction, autoAssignUnsold,
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
        <div className="w-full max-w-2xl space-y-3">
          {teams.map(team => (
            <div key={team.id} className="bg-gray-900 rounded-xl p-4 text-left">
              <p className="font-semibold mb-2">{team.name}</p>
              {team.players.length === 0 ? (
                <p className="text-sm text-gray-500">No players</p>
              ) : (
                <div className="space-y-2">
                  {[...team.players].reverse().map(player => (
                    <div key={player.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <PlayerAvatar name={player.name} photoUrl={player.photoUrl} size="xs" />
                        <span className="text-gray-300 truncate">{player.name}</span>
                      </div>
                      <button
                        onClick={() => { if (window.confirm(`Return ${player.name} to the auction queue? This removes the player from ${team.name} and refunds the sale.`)) returnSoldToQueue(player.id) }}
                        className="text-cyan-300 border border-cyan-800 rounded px-2 py-1 hover:text-white"
                      >
                        ↺ Return to Queue
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-4">
          {state.players.some(p => p.status === 'unsold') && (
            <>
              <button onClick={autoAssignUnsold} className="bg-purple-700 hover:bg-purple-600 text-white font-bold text-lg px-8 py-4 rounded-2xl shadow-lg shadow-purple-900 transition-all hover:scale-105 cursor-pointer">
                🎲 Auto-Assign Remaining
              </button>
              <button onClick={requeueUnsold} className="btn-secondary">Re-auction unsold players</button>
            </>
          )}
          <button onClick={() => navigate('/results')} className="animate-pulse-ring bg-blue-600 hover:bg-blue-500 text-white font-bold text-lg px-8 py-4 rounded-2xl shadow-lg shadow-blue-900 transition-all hover:scale-105 cursor-pointer">
            View Results →
          </button>
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
                <PlayerAvatar name={currentPlayer.name} photoUrl={currentPlayer.photoUrl} size="xl" className="mx-auto mb-4" />
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
                    <p className="text-4xl font-extrabold text-blue-300 mt-2">🔥 {leadingTeam.name}</p>
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
                      const nextPrice = state.bids.length === 0
                        ? state.currentPrice
                        : state.currentPrice + getIncrement(state.currentPrice, config)
                      const maxPlayers = Number(config.maxPlayersPerTeam) || 0
                      const rosterFull = maxPlayers > 0 && team.players.length >= maxPlayers
                      const canBid = team.budget >= nextPrice
                        && !paused
                        && state.leadingTeamId !== team.id
                        && !rosterFull
                      return (
                        <button
                          key={team.id}
                          onClick={() => recordBid(team.id)}
                          disabled={!canBid}
                          className={`rounded-xl py-3 px-4 font-bold text-sm transition-all ${
                            canBid
                              ? 'bg-gray-700 hover:bg-gray-600 text-white'
                              : rosterFull
                                ? 'bg-red-950 text-red-400 cursor-not-allowed ring-2 ring-red-700'
                                : state.leadingTeamId === team.id
                                  ? 'bg-blue-900 text-blue-300 cursor-not-allowed ring-2 ring-blue-500'
                                  : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                          }`}
                        >
                          <span className="block truncate">{team.name}</span>
                          {rosterFull ? (
                            <span className="block text-xs font-normal mt-1">🚫 Roster Full</span>
                          ) : state.leadingTeamId === team.id ? (
                            <span className="block text-xs font-normal mt-1">🔥 Leading</span>
                          ) : (
                            <>
                              <span className="block text-xs font-normal mt-1 text-gray-400">{team.budget} pts left</span>
                              <span className="block text-xs font-normal text-gray-500">After bid: {team.budget - nextPrice} pts</span>
                            </>
                          )}
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
                <div className="flex flex-col items-center gap-2">
                  {status === 'sold' && (
                    <div className="flex gap-2">
                      <button onClick={() => { if (window.confirm('Reopen bidding for this sold player? This will remove the player from the team and restore the winning bid.')) reopenSold() }} className="bg-blue-700 hover:bg-blue-600 text-white rounded-xl py-2 px-4 font-bold text-sm">
                        ↩ Reopen Bidding
                      </button>
                      <button onClick={() => { if (window.confirm('Move this sold player to unsold? This will remove the player from the team and refund the sale.')) soldToUnsold() }} className="bg-yellow-700 hover:bg-yellow-600 text-white rounded-xl py-2 px-4 font-bold text-sm">
                        ↩ To Unsold
                      </button>
                    </div>
                  )}
                  <button onClick={nextPlayer} className="btn-primary text-lg px-8 py-3">
                    Next Player →
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Right panel: Teams & Bid log ── */}
        <div className="w-72 bg-gray-900 border-l border-gray-800 flex flex-col" style={{height: 'calc(100vh - 57px)'}}>
          {/* Teams — always fully visible */}
          <div className="p-4 border-b border-gray-800 shrink-0">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Teams</p>
            <div className="space-y-1.5">
              {teams.map(team => {
                const pct = Math.round((team.budget / saved.config.pointsPerTeam) * 100)
                const isExpanded = expandedTeamId === team.id
                const isLeading = state.leadingTeamId === team.id
                return (
                  <div key={team.id} className={`rounded-lg overflow-hidden ${isLeading ? 'ring-1 ring-blue-500' : ''}`}>
                    {/* Team header row — click to expand */}
                    <button
                      onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                      className={`w-full px-2 pt-2 pb-1 text-left transition-colors ${
                        isLeading ? 'bg-blue-900/60' : 'bg-gray-800 hover:bg-gray-750'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium truncate">{team.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-yellow-400 font-bold">{team.budget}</span>
                          <span className="text-gray-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-1.5 mb-1">
                        <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-gray-500">{team.players.length} player{team.players.length !== 1 ? 's' : ''}</p>
                    </button>
                    {/* Expanded roster */}
                    {isExpanded && (
                      <div className={`px-2 pb-2 text-left ${isLeading ? 'bg-blue-900/40' : 'bg-gray-800'}`}>
                        {team.players.length === 0 ? (
                          <p className="text-xs text-gray-600 py-1 italic">No players yet</p>
                        ) : (
                          <div className="space-y-0.5 mt-1">
                            {[...team.players].reverse().map((p, i) => (
                              <div key={i} className="flex items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
                                  <span className="text-gray-300 truncate">{p.name}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-yellow-400 font-mono">{p.soldPrice}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (window.confirm(`Return ${p.name} to the auction queue? This removes the player from ${team.name} and refunds the sale.`)) {
                                        returnSoldToQueue(p.id)
                                      }
                                    }}
                                    className="text-cyan-300 hover:text-white border border-cyan-900 rounded px-1.5 py-0.5"
                                  >
                                    ↺
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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
