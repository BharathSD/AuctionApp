import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnlineAuction } from '../hooks/useOnlineAuction'
import { getIncrement, minCostForRemainingSpots } from '../utils/bidTiers'
import PlayerAvatar from '../components/PlayerAvatar'

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
  const [availableSearch, setAvailableSearch] = useState('')
  const [availableRoles, setAvailableRoles] = useState([])
  const [availableStatuses, setAvailableStatuses] = useState([])
  const [availableSort, setAvailableSort] = useState('status')
  const [showRoleFilter, setShowRoleFilter] = useState(false)
  const [showStatusFilter, setShowStatusFilter] = useState(false)

  const {
    state, currentPlayer, leadingTeam,
    captainBid, clearError, clearSessionError,
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

  // Session kicked or rejected
  if (state.sessionError) {
    const likelyDuplicate = /already connected/i.test(state.sessionError)
    const likelyInvalid = /invalid captain session/i.test(state.sessionError)
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-6 p-6 text-center">
        <div className="text-6xl">🚫</div>
        <h2 className="text-2xl font-bold text-red-400">Session Ended</h2>
        <p className="text-gray-400 max-w-sm">{state.sessionError}</p>
        {likelyDuplicate && (
          <p className="text-yellow-300 text-sm max-w-sm">This usually means your team is active on another device or tab. Close that session or ask the auctioneer to kick it, then rejoin.</p>
        )}
        {likelyInvalid && (
          <p className="text-yellow-300 text-sm max-w-sm">Your join session expired. Rejoin with your team PIN to continue bidding.</p>
        )}
        <div className="flex gap-3 flex-wrap justify-center">
          <button
            onClick={() => {
              clearSessionError()
              sessionStorage.removeItem('captain_token')
              sessionStorage.removeItem('captain_teamId')
              sessionStorage.removeItem('captain_teamName')
              navigate(`/join/${roomCode}`)
            }}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 py-3 rounded-xl"
          >
            Rejoin with PIN
          </button>
          <button
            onClick={() => { sessionStorage.clear(); navigate('/') }}
            className="bg-gray-700 hover:bg-gray-600 text-white font-bold px-6 py-3 rounded-xl"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  const myTeam = state.teams.find(t => t.id === teamId)
  const { status, timerLeft, config, bids } = state
  const allAvailablePlayers = useMemo(
    () => (state.players || []).filter(p => p.status === 'pending' || p.status === 'unsold'),
    [state.players]
  )
  const pendingCount = allAvailablePlayers.filter(p => p.status === 'pending').length
  const unsoldCount = allAvailablePlayers.length - pendingCount
  const uniqueAvailableRoles = useMemo(() => {
    const roles = new Set(allAvailablePlayers.map(p => p.role).filter(Boolean))
    return Array.from(roles).sort()
  }, [allAvailablePlayers])

  const availablePlayers = useMemo(() => {
    let filtered = [...allAvailablePlayers]

    if (availableSearch.trim()) {
      const q = availableSearch.trim().toLowerCase()
      filtered = filtered.filter(p => String(p.name || '').toLowerCase().includes(q))
    }

    if (availableRoles.length > 0) {
      filtered = filtered.filter(p => availableRoles.includes(p.role))
    }

    if (availableStatuses.length > 0) {
      filtered = filtered.filter(p => availableStatuses.includes(p.status))
    }

    if (availableSort === 'status') {
      filtered.sort((a, b) => {
        const order = { pending: 0, unsold: 1 }
        return (order[a.status] ?? 99) - (order[b.status] ?? 99)
      })
    } else if (availableSort === 'role') {
      filtered.sort((a, b) => String(a.role || '').localeCompare(String(b.role || '')))
    } else if (availableSort === 'priceDesc') {
      filtered.sort((a, b) => Number(b.basePrice || 0) - Number(a.basePrice || 0))
    } else if (availableSort === 'priceAsc') {
      filtered.sort((a, b) => Number(a.basePrice || 0) - Number(b.basePrice || 0))
    } else if (availableSort === 'name') {
      filtered.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    }

    return filtered
  }, [allAvailablePlayers, availableSearch, availableRoles, availableStatuses, availableSort])

  const toggleRole = (role) => {
    setAvailableRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role])
  }

  const toggleStatus = (statusValue) => {
    setAvailableStatuses(prev => prev.includes(statusValue) ? prev.filter(s => s !== statusValue) : [...prev, statusValue])
  }
  const isLeading = state.leadingTeamId === teamId
  const nextBidPrice = state.bids && state.bids.length === 0
    ? (state.currentPrice ?? 0)
    : (state.currentPrice ?? 0) + getIncrement(state.currentPrice ?? 0, config)

  // Affordability check: after bidding, can the team still cover remaining roster spots?
  const maxPlayers = Number(config.maxPlayersPerTeam) || 0
  const currentPlayerIdx = state.queue != null && state.currentIdx >= 0 ? state.queue[state.currentIdx] : -1
  const spotsFilledAfter = (myTeam?.players?.length ?? 0) + 1
  const spotsNeededAfter = maxPlayers > 0 ? Math.max(0, maxPlayers - spotsFilledAfter) : 0
  const minNeededForRest = maxPlayers > 0 && spotsNeededAfter > 0
    ? minCostForRemainingSpots(state.players ?? [], currentPlayerIdx, spotsNeededAfter)
    : 0
  const canAffordRemaining = !myTeam || maxPlayers === 0 || (myTeam.budget - nextBidPrice) >= minNeededForRest

  const canBid = state.connected && status === 'running' && !state.paused && myTeam && myTeam.budget >= nextBidPrice && !isLeading && canAffordRemaining

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
        <button onClick={() => setActiveTab('available')} className={`flex-1 py-2.5 text-sm font-medium ${activeTab === 'available' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500'}`}>📋 Available</button>
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
                  <PlayerAvatar name={currentPlayer.name} photoUrl={currentPlayer.photoUrl} size="2xl" className="mx-auto mb-3" />
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

              {/* Budget info */}
              {myTeam && status === 'running' && (
                <div className="w-full max-w-xs bg-gray-800 rounded-2xl px-5 py-3 text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-400">Available budget</span>
                    <span className="font-bold text-white">{myTeam.budget} pts</span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-gray-400">Next bid costs</span>
                    <span className="font-bold text-yellow-400">{nextBidPrice} pts</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-700 pt-2">
                    <span className="text-gray-400">Budget after bid</span>
                    <span className={`font-bold ${myTeam.budget - nextBidPrice >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {myTeam.budget - nextBidPrice} pts
                    </span>
                  </div>
                  {config.maxPlayersPerTeam && (
                    <div className="flex justify-between border-t border-gray-700 pt-2 mt-2">
                      <span className="text-gray-400">Roster</span>
                      <span className={`font-bold ${myTeam.players?.length >= config.maxPlayersPerTeam ? 'text-red-400' : 'text-gray-300'}`}>
                        {myTeam.players?.length ?? 0} / {config.maxPlayersPerTeam}
                      </span>
                    </div>
                  )}
                </div>
              )}

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

              {/* BID BUTTON */}
              {!state.connected && status === 'running' && (
                <div className="w-full max-w-xs rounded-2xl py-4 text-center bg-yellow-900/40 border border-yellow-700 text-yellow-300 text-sm">
                  Reconnecting to server. Bidding will resume automatically once connected.
                </div>
              )}
              {status === 'running' && state.paused && (
                <div className="w-full max-w-xs rounded-2xl py-5 text-center bg-yellow-900/50 border border-yellow-700 text-yellow-300 font-bold text-lg">
                  ⏸ Auction Paused
                </div>
              )}
              {status === 'running' && !state.paused && (
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
                   bidFlash === 'late' ? 'Too late!' :
                   isLeading ? '🔥 You\'re leading!' :
                   config.maxPlayersPerTeam && myTeam?.players?.length >= config.maxPlayersPerTeam ? '🚫 Roster Full' :
                   !canAffordRemaining ? '💸 Can\'t fill roster' :
                   canBid ? `BID ${nextBidPrice} pts` :
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
                <div className="flex items-center gap-2 min-w-0">
                  <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                  <div className="min-w-0">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-gray-500">{p.role}</p>
                  </div>
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

      {/* ── AVAILABLE TAB ── */}
      {activeTab === 'available' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="bg-gray-900 rounded-xl p-4 mb-4 flex items-center justify-between text-sm">
            <p className="text-gray-400">Pending: <span className="text-yellow-400 font-bold">{pendingCount}</span> | Unsold: <span className="text-red-400 font-bold">{unsoldCount}</span></p>
            <p className="text-gray-500">Total: <span className="text-white font-bold">{allAvailablePlayers.length}</span></p>
          </div>

          <div className="bg-gray-900 rounded-xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Search</label>
              <input
                value={availableSearch}
                onChange={(e) => setAvailableSearch(e.target.value)}
                placeholder="Player name"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="relative">
              <label className="text-xs text-gray-500 block mb-1">Role</label>
              <button
                type="button"
                onClick={() => {
                  setShowRoleFilter(v => !v)
                  setShowStatusFilter(false)
                }}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white text-left"
              >
                {availableRoles.length === 0 ? 'All roles' : `${availableRoles.length} selected`}
              </button>
              {showRoleFilter && (
                <div className="absolute z-30 mt-2 w-full bg-gray-800 border border-gray-700 rounded-lg p-2 max-h-52 overflow-y-auto shadow-lg">
                  <button
                    type="button"
                    onClick={() => setAvailableRoles([])}
                    className="w-full text-left text-xs text-blue-300 hover:text-blue-200 px-2 py-1"
                  >
                    Clear all
                  </button>
                  {uniqueAvailableRoles.map(role => (
                    <label key={role} className="flex items-center gap-2 px-2 py-1 text-sm text-gray-200 hover:bg-gray-700 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={availableRoles.includes(role)}
                        onChange={() => toggleRole(role)}
                        className="accent-blue-500"
                      />
                      <span>{role}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="text-xs text-gray-500 block mb-1">Status</label>
              <button
                type="button"
                onClick={() => {
                  setShowStatusFilter(v => !v)
                  setShowRoleFilter(false)
                }}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white text-left"
              >
                {availableStatuses.length === 0 ? 'All status' : `${availableStatuses.length} selected`}
              </button>
              {showStatusFilter && (
                <div className="absolute z-30 mt-2 w-full bg-gray-800 border border-gray-700 rounded-lg p-2 shadow-lg">
                  <button
                    type="button"
                    onClick={() => setAvailableStatuses([])}
                    className="w-full text-left text-xs text-blue-300 hover:text-blue-200 px-2 py-1"
                  >
                    Clear all
                  </button>
                  {['pending', 'unsold'].map(statusValue => (
                    <label key={statusValue} className="flex items-center gap-2 px-2 py-1 text-sm text-gray-200 hover:bg-gray-700 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={availableStatuses.includes(statusValue)}
                        onChange={() => toggleStatus(statusValue)}
                        className="accent-blue-500"
                      />
                      <span>{statusValue === 'pending' ? 'Pending' : 'Unsold'}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Sort</label>
              <select
                value={availableSort}
                onChange={(e) => setAvailableSort(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white"
              >
                <option value="status">Status</option>
                <option value="name">Name A-Z</option>
                <option value="role">Role A-Z</option>
                <option value="priceDesc">Price high to low</option>
                <option value="priceAsc">Price low to high</option>
              </select>
            </div>
          </div>

          {availablePlayers.length === 0 ? (
            <p className="text-gray-500 text-sm">No players match the current search/filter.</p>
          ) : (
            <div className="space-y-2">
              {availablePlayers.map((p, i) => (
                <div key={`${p.id || p.name || 'player'}-${i}`} className="bg-gray-800 rounded-xl px-4 py-3 flex justify-between items-center gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                    <div className="min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-gray-500">{p.role}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-yellow-400 font-bold">{p.basePrice} pts</p>
                    <p className={`text-xs font-semibold ${p.status === 'pending' ? 'text-yellow-400' : 'text-red-400'}`}>
                      {p.status === 'pending' ? 'Pending' : 'Unsold'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
