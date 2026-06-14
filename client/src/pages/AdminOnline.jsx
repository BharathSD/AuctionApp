import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadAuctionState, saveAuctionConfig } from '../hooks/useAuctionStorage'
import { useOnlineAuction } from '../hooks/useOnlineAuction'

const ROLE_COLORS = {
  Batsman: 'bg-blue-700',
  Bowler: 'bg-green-700',
  'All-rounder': 'bg-purple-700',
  'Wicket-keeper': 'bg-orange-700',
}

export default function AdminOnline() {
  const navigate = useNavigate()
  const saved = loadAuctionState()
  const [roomReady, setRoomReady] = useState(false)
  const [roomCode, setRoomCode] = useState(saved?.roomCode || null)
  const [expandedTeamId, setExpandedTeamId] = useState(null)
  const [linkCopied, setLinkCopied] = useState(false)

  // Push auction config to server on mount
  useEffect(() => {
    if (!saved || !saved.roomCode) return
    fetch('/api/auction/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: saved.roomCode, auctionData: saved }),
    })
      .then(r => r.json())
      .then(() => setRoomReady(true))
      .catch(() => setRoomReady(true)) // allow retry via socket
  }, [])

  const {
    state, currentPlayer, leadingTeam,
    adminNextPlayer, adminUndoBid, adminFinish, adminSold, adminUnsold, adminRequeueUnsold,
  } = useOnlineAuction({ roomCode, role: 'admin', teamId: null })

  if (!saved) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">No auction configured.</p>
          <button onClick={() => navigate('/setup/online')} className="btn-primary">Set up auction</button>
        </div>
        <style>{`.btn-primary{background:#2563eb;color:white;padding:.5rem 1.25rem;border-radius:.75rem;font-weight:600;cursor:pointer}`}</style>
      </div>
    )
  }

  const { status, teams, bids, timerLeft, config } = state
  const soldCount = state.players.filter(p => p.status === 'sold').length
  const totalPlayers = state.players.length
  const joinUrl = `${window.location.origin}/join/${roomCode}`

  if (status === 'finished') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-6 p-6">
        <div className="text-6xl">🏆</div>
        <h2 className="text-3xl font-bold">Auction Complete!</h2>
        <p className="text-gray-400">{soldCount} of {totalPlayers} players sold</p>
        <div className="flex gap-4">
          {state.players.some(p => p.status === 'unsold') && (
            <button onClick={adminRequeueUnsold} className="btn-secondary">Re-auction unsold</button>
          )}
          <button onClick={() => navigate('/results')} className="animate-pulse-ring bg-blue-600 hover:bg-blue-500 text-white font-bold text-lg px-8 py-4 rounded-2xl shadow-lg shadow-blue-900 transition-all hover:scale-105 cursor-pointer">
            View Results →
          </button>
        </div>
        <style>{`.btn-primary{background:#2563eb;color:white;padding:.5rem 1.25rem;border-radius:.75rem;font-weight:600;cursor:pointer}.btn-secondary{background:#374151;color:white;padding:.5rem 1.25rem;border-radius:.75rem;font-weight:600;cursor:pointer}`}</style>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Top bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="font-bold text-lg">🏏 Admin</span>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">ONLINE</span>
          <span className={`text-xs px-2 py-1 rounded ${state.connected ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
            {state.connected ? '● Live' : '○ Connecting…'}
          </span>
          {state.secondRound && (
            <span className="text-xs bg-orange-700 text-orange-100 px-2 py-1 rounded font-semibold">🔁 Unsold Round</span>
          )}
        </div>
        {/* Room code + join link */}
        <div className="flex items-center gap-3">
          <div className="bg-gray-800 rounded-lg px-3 py-1 text-sm">
            <span className="text-gray-500">Room: </span>
            <span className="font-mono font-bold text-yellow-400">{roomCode}</span>
          </div>
          <div className="relative">
            <button
              onClick={() => {
                navigator.clipboard?.writeText(joinUrl)
                setLinkCopied(true)
                setTimeout(() => setLinkCopied(false), 2000)
              }}
              className="text-xs bg-blue-800 hover:bg-blue-700 px-3 py-1.5 rounded-lg"
            >
              Copy join link
            </button>
            {linkCopied && (
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 bg-green-700 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-50">
                ✓ Link copied!
              </div>
            )}
          </div>
          <span className="text-xs text-gray-500">{soldCount}/{totalPlayers} sold</span>
          {status !== 'idle' && status !== 'finished' && (
            <button
              onClick={() => { if (window.confirm('End the auction now? Remaining players will be skipped.')) adminFinish() }}
              className="text-red-400 hover:text-red-300 text-xs border border-red-800 px-2 py-1 rounded"
            >
              ⏹ Finish
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: current player + controls ── */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          {(status === 'idle') && (
            <div className="text-center">
              <p className="text-gray-400 mb-2">Share the join link with captains, then start.</p>
              <p className="font-mono text-blue-300 text-sm mb-6 break-all">{joinUrl}</p>
              <div className="mb-4 text-sm text-gray-400">
                Connected captains: <span className="text-white">{state.connectedTeamIds.length}</span> / {config.numTeams}
              </div>
              <button onClick={adminNextPlayer} className="btn-primary text-xl px-10 py-4">
                🚀 Start Auction
              </button>
            </div>
          )}

          {(status === 'running' || status === 'sold' || status === 'unsold') && currentPlayer && (
            <>
              <div className="bg-gray-800 rounded-3xl p-8 text-center w-full max-w-sm shadow-2xl border border-gray-700">
                <div className={`inline-block px-3 py-1 rounded-full text-xs font-bold mb-4 ${ROLE_COLORS[currentPlayer.role] || 'bg-gray-700'}`}>
                  {currentPlayer.role}
                </div>
                <h2 className="text-4xl font-extrabold mb-2">{currentPlayer.name}</h2>
                <p className="text-gray-400 text-sm mb-6">Base: {currentPlayer.basePrice} pts</p>

                <div className="bg-gray-900 rounded-2xl p-4 mb-4">
                  <p className="text-xs text-gray-500 mb-1">Current Bid</p>
                  <p className="text-5xl font-black text-yellow-400">{state.currentPrice}</p>
                  {leadingTeam && <p className="text-sm text-blue-300 mt-2 font-semibold">🔥 {leadingTeam.name}</p>}
                  {!leadingTeam && status === 'running' && <p className="text-sm text-gray-500 mt-2">No bids yet</p>}
                </div>

                {config.timerEnabled && status === 'running' && (
                  <div className={`text-4xl font-bold ${timerLeft <= 5 ? 'text-red-400 animate-pulse' : 'text-gray-300'}`}>
                    {timerLeft}s
                  </div>
                )}

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

              {status === 'running' && !config.timerEnabled && (
                <div className="flex gap-3 flex-wrap justify-center">
                  <button onClick={adminSold} disabled={!leadingTeam} className="bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl py-3 px-6 font-bold">
                    ✅ Sold
                  </button>
                  <button onClick={adminUnsold} className="bg-red-800 hover:bg-red-700 text-white rounded-xl py-3 px-6 font-bold">
                    ❌ Unsold
                  </button>
                  <button onClick={adminUndoBid} disabled={!bids.length} className="bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl py-3 px-5 font-bold text-sm">
                    ↩ Undo
                  </button>
                </div>
              )}
              {status === 'running' && config.timerEnabled && (
                <button onClick={adminUndoBid} disabled={!bids.length} className="bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl py-2 px-5 font-bold text-sm">
                  ↩ Undo Last Bid
                </button>
              )}

              {(status === 'sold' || status === 'unsold') && (
                <button onClick={adminNextPlayer} className="btn-primary text-lg px-8 py-3">
                  Next Player →
                </button>
              )}
            </>
          )}
        </div>

        {/* ── Right: teams + bid log ── */}
        <div className="w-72 bg-gray-900 border-l border-gray-800 flex flex-col" style={{height: 'calc(100vh - 57px)'}}>
          {/* Teams — always fully visible */}
          <div className="p-4 border-b border-gray-800 shrink-0">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Teams</p>
            <div className="space-y-1.5">
              {teams.map(team => {
                const pct = Math.round((team.budget / (saved.config.pointsPerTeam)) * 100)
                const isOnline = state.connectedTeamIds.includes(team.id)
                const isLeading = state.leadingTeamId === team.id
                const isExpanded = expandedTeamId === team.id
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
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline ? 'bg-green-400' : 'bg-gray-600'}`} />
                          <span className="text-sm font-medium truncate">{team.name}</span>
                        </div>
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
                            {team.players.map((p, i) => (
                              <div key={i} className="flex justify-between text-xs">
                                <span className="text-gray-300 truncate">{p.name}</span>
                                <span className="text-yellow-400 font-mono ml-2 shrink-0">{p.soldPrice}</span>
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
