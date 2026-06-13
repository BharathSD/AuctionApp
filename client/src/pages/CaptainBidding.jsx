import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnlineAuction } from '../hooks/useOnlineAuction'

const ROLE_COLORS = {
  Batsman: 'text-blue-400',
  Bowler: 'text-green-400',
  'All-rounder': 'text-purple-400',
  'Wicket-keeper': 'text-orange-400',
}

export default function CaptainBidding() {
  const navigate = useNavigate()
  const roomCode = sessionStorage.getItem('captain_roomCode')
  const teamId = sessionStorage.getItem('captain_teamId')
  const teamName = sessionStorage.getItem('captain_teamName')
  const [activeTab, setActiveTab] = useState('bid') // bid | roster
  const [bidFlash, setBidFlash] = useState(null) // 'ok' | 'late' | 'low'

  const {
    state, currentPlayer, leadingTeam,
    captainBid, clearError,
  } = useOnlineAuction({ roomCode, role: 'captain', teamId })

  // Redirect if not joined
  useEffect(() => {
    if (!roomCode || !teamId) navigate(`/`)
  }, [roomCode, teamId, navigate])

  // Show feedback flash on bid rejection
  useEffect(() => {
    if (state.lastError) {
      setBidFlash('late')
      clearError()
      const t = setTimeout(() => setBidFlash(null), 1500)
      return () => clearTimeout(t)
    }
  }, [state.lastError, clearError])

  const myTeam = state.teams.find(t => t.id === teamId)
  const { status, timerLeft, config, bids } = state
  const isLeading = state.leadingTeamId === teamId
  const nextBidPrice = (state.currentPrice ?? 0) + (config.bidIncrement ?? 0)
  const canBid = status === 'running' && myTeam && myTeam.budget >= nextBidPrice && !isLeading

  const handleBid = () => {
    if (!canBid) return
    captainBid()
    setBidFlash('ok')
    setTimeout(() => setBidFlash(null), 800)
  }

  if (!roomCode || !teamId) return null

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col" style={{ minHeight: '100dvh' }}>
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="font-bold text-sm">{teamName}</p>
          <p className="text-xs text-gray-500">Room: <span className="font-mono text-yellow-400">{roomCode}</span></p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded ${state.connected ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300 animate-pulse'}`}>
            {state.connected ? '● Live' : '○ Reconnecting…'}
          </span>
          {myTeam && (
            <div className="text-right">
              <p className="text-xs text-gray-500">Budget</p>
              <p className="font-bold text-yellow-400">{myTeam.budget} pts</p>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-gray-900 border-b border-gray-800">
        <button onClick={() => setActiveTab('bid')} className={`flex-1 py-2.5 text-sm font-medium ${activeTab === 'bid' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500'}`}>🏏 Bid</button>
        <button onClick={() => setActiveTab('roster')} className={`flex-1 py-2.5 text-sm font-medium ${activeTab === 'roster' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500'}`}>👕 My Roster</button>
        <button onClick={() => setActiveTab('teams')} className={`flex-1 py-2.5 text-sm font-medium ${activeTab === 'teams' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500'}`}>📊 Teams</button>
      </div>

      {/* ── BID TAB ── */}
      {activeTab === 'bid' && (
        <div className="flex-1 flex flex-col items-center justify-between p-6 gap-4">
          {status === 'idle' && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-400 text-center">Waiting for the auctioneer to start…</p>
            </div>
          )}

          {status === 'finished' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="text-5xl">🏆</div>
              <p className="text-xl font-bold">Auction Complete!</p>
              <button onClick={() => setActiveTab('roster')} className="text-blue-400 underline text-sm">View your roster</button>
            </div>
          )}

          {(status === 'running' || status === 'sold' || status === 'unsold') && (
            <>
              {/* Player card */}
              {currentPlayer && (
                <div className="w-full max-w-xs bg-gray-800 rounded-2xl p-6 text-center">
                  <p className={`text-sm font-semibold mb-1 ${ROLE_COLORS[currentPlayer.role] || 'text-gray-400'}`}>
                    {currentPlayer.role}
                  </p>
                  <h2 className="text-3xl font-extrabold mb-1">{currentPlayer.name}</h2>
                  <p className="text-gray-500 text-xs">Base: {currentPlayer.basePrice} pts</p>
                </div>
              )}

              {/* Current bid display */}
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">Current Bid</p>
                <p className="text-6xl font-black text-yellow-400">{state.currentPrice}</p>
                {isLeading && <p className="text-green-400 font-bold mt-2 text-sm">🔥 You're leading!</p>}
                {!isLeading && leadingTeam && <p className="text-gray-400 text-sm mt-2">{leadingTeam.name} is leading</p>}
                {!leadingTeam && status === 'running' && <p className="text-gray-500 text-sm mt-2">No bids yet — be first!</p>}
              </div>

              {/* Timer */}
              {config.timerEnabled && status === 'running' && (
                <div className={`text-4xl font-bold ${timerLeft <= 5 ? 'text-red-400 animate-pulse' : 'text-gray-400'}`}>
                  {timerLeft}s
                </div>
              )}

              {/* Status outcomes */}
              {status === 'sold' && (
                <div className={`rounded-xl px-6 py-3 font-bold text-lg ${isLeading || state.leadingTeamId === teamId ? 'bg-green-800 text-green-200' : 'bg-gray-800 text-gray-300'}`}>
                  {state.leadingTeamId === teamId ? '🎉 You won this player!' : `✅ Sold to ${leadingTeam?.name}`}
                </div>
              )}
              {status === 'unsold' && (
                <div className="bg-red-900 rounded-xl px-6 py-3 text-red-200 font-bold text-lg">❌ Unsold</div>
              )}

              {/* BIG BID BUTTON */}
              {status === 'running' && (
                <button
                  onClick={handleBid}
                  disabled={!canBid}
                  className={`w-full max-w-xs rounded-2xl py-6 text-2xl font-black transition-all active:scale-95 ${
                    bidFlash === 'ok' ? 'bg-green-500 text-white' :
                    bidFlash === 'late' ? 'bg-red-600 text-white' :
                    canBid ? (isLeading ? 'bg-blue-600 text-white' : 'bg-yellow-500 text-gray-900 hover:bg-yellow-400') :
                    'bg-gray-800 text-gray-600 cursor-not-allowed'
                  }`}
                >
                  {bidFlash === 'ok' ? '✓ Bid placed!' :
                   bidFlash === 'late' ? 'Too late!' :                   isLeading ? '🔥 You\'re leading!' :                   canBid ? `BID ${nextBidPrice} pts` :
                   myTeam && myTeam.budget < nextBidPrice ? 'Budget too low' : 'Waiting…'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ROSTER TAB ── */}
      {activeTab === 'roster' && (
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-4">Your Players</p>
          {myTeam?.players.length === 0 && <p className="text-gray-600 text-sm">No players yet</p>}
          <div className="space-y-2">
            {myTeam?.players.map((p, i) => (
              <div key={i} className="bg-gray-800 rounded-xl px-4 py-3 flex justify-between items-center">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-gray-500">{p.role}</p>
                </div>
                <p className="text-yellow-400 font-bold">{p.soldPrice} pts</p>
              </div>
            ))}
          </div>
          {myTeam && (
            <div className="mt-4 bg-gray-900 rounded-xl p-4 flex justify-between text-sm">
              <span className="text-gray-400">Budget remaining</span>
              <span className="text-yellow-400 font-bold">{myTeam.budget} pts</span>
            </div>
          )}
        </div>
      )}

      {/* ── TEAMS TAB ── */}
      {activeTab === 'teams' && (
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-4">All Teams</p>
          <div className="space-y-3">
            {state.teams.map(team => {
              const pct = state.config.pointsPerTeam ? Math.round((team.budget / state.config.pointsPerTeam) * 100) : 0
              return (
                <div key={team.id} className={`bg-gray-800 rounded-xl p-4 ${team.id === teamId ? 'ring-1 ring-blue-500' : ''}`}>
                  <div className="flex justify-between mb-2">
                    <span className="font-medium">{team.name} {team.id === teamId ? '(you)' : ''}</span>
                    <span className="text-yellow-400 font-bold">{team.budget} pts</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2 mb-1">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-gray-500">{team.players.length} players</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
