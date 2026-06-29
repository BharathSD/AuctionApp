import React, { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useOnlineAuction } from '../hooks/useOnlineAuction'
import { loadAuctionState } from '../hooks/useAuctionStorage'
import PlayerAvatar from '../components/PlayerAvatar'

const ROLE_COLORS = {
  Batsman: 'bg-blue-700',
  Bowler: 'bg-green-700',
  'All-rounder': 'bg-purple-700',
  'Wicket-keeper': 'bg-orange-700',
}

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-900',
  unsold: 'bg-red-100 text-red-900',
}

export default function AvailablePlayers() {
  const navigate = useNavigate()
  const { roomCode: paramRoomCode } = useParams()
  const saved = loadAuctionState()
  const roomCode = paramRoomCode || saved?.roomCode
  const teamId = sessionStorage.getItem('captain_teamId')
  const captainRoomCode = sessionStorage.getItem('captain_roomCode')

  // Determine role
  let role = 'viewer'
  if (saved?.adminToken && roomCode === saved?.roomCode) {
    role = 'admin'
  } else if (teamId && captainRoomCode === roomCode) {
    role = 'captain'
  }

  const { state } = useOnlineAuction({
    roomCode,
    role,
    teamId: role === 'captain' ? teamId : null,
  })
  const connected = state.connected

  const [sortBy, setSortBy] = useState('status') // 'status', 'role', 'price'
  const [filterRole, setFilterRole] = useState('all')

  if (!roomCode) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">No active auction found.</p>
          <button onClick={() => navigate('/')} className="btn-primary">Go Home</button>
        </div>
        <style>{`.btn-primary{background:#2563eb;color:white;padding:.5rem 1.25rem;border-radius:.75rem;font-weight:600;cursor:pointer}`}</style>
      </div>
    )
  }

  const players = state.players || []
  const teams = state.teams || []
  const teamsMap = new Map(teams.map(t => [t.id, t]))

  // Get available players (pending + unsold)
  const availablePlayers = useMemo(() => {
    let available = players.filter(p => p.status === 'pending' || p.status === 'unsold')

    // Apply role filter
    if (filterRole !== 'all') {
      available = available.filter(p => p.role === filterRole)
    }

    // Sort
    if (sortBy === 'status') {
      available.sort((a, b) => {
        const statusOrder = { pending: 0, unsold: 1 }
        return statusOrder[a.status] - statusOrder[b.status]
      })
    } else if (sortBy === 'role') {
      available.sort((a, b) => a.role.localeCompare(b.role))
    } else if (sortBy === 'price') {
      available.sort((a, b) => Number(b.basePrice || 0) - Number(a.basePrice || 0))
    }

    return available
  }, [players, sortBy, filterRole])

  const uniqueRoles = useMemo(() => {
    const roles = new Set(players.map(p => p.role))
    return Array.from(roles).sort()
  }, [players])

  const pendingCount = availablePlayers.filter(p => p.status === 'pending').length
  const unsoldCount = availablePlayers.filter(p => p.status === 'unsold').length
  const totalAvailable = availablePlayers.length

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="text-gray-400 hover:text-white text-lg"
            >
              ←
            </button>
            <span className="font-bold text-lg">📋 Available Players</span>
            <span className={`text-xs px-2 py-1 rounded ${connected ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
              {connected ? '● Live' : '○ Offline'}
            </span>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <div className="bg-gray-800 rounded px-3 py-1">
              <span className="text-xs text-gray-500">Pending: </span>
              <span className="font-bold text-yellow-400">{pendingCount}</span>
              <span className="text-xs text-gray-500 mx-2">|</span>
              <span className="text-xs text-gray-500">Unsold: </span>
              <span className="font-bold text-red-400">{unsoldCount}</span>
              <span className="text-xs text-gray-500 mx-2">|</span>
              <span className="text-xs text-gray-500">Total: </span>
              <span className="font-bold text-white">{totalAvailable}</span>
            </div>

            {role === 'admin' && (
              <span className="text-xs bg-blue-900 text-blue-300 px-2 py-1 rounded font-semibold">
                ADMIN VIEW
              </span>
            )}
            {role === 'captain' && (
              <span className="text-xs bg-purple-900 text-purple-300 px-2 py-1 rounded font-semibold">
                CAPTAIN VIEW
              </span>
            )}
            {role === 'viewer' && (
              <span className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded font-semibold">
                VIEWER
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Filters & Sort */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex flex-wrap gap-4 items-center">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Filter by Role:</label>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="bg-gray-800 text-white text-sm px-2 py-1 rounded border border-gray-700"
          >
            <option value="all">All Roles</option>
            {uniqueRoles.map(role => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-500 block mb-1">Sort by:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-gray-800 text-white text-sm px-2 py-1 rounded border border-gray-700"
          >
            <option value="status">Status (Pending first)</option>
            <option value="role">Role (A-Z)</option>
            <option value="price">Price (High to Low)</option>
          </select>
        </div>
      </div>

      {/* Players List */}
      <div className="flex-1 overflow-auto p-4">
        {totalAvailable === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <p className="text-lg mb-2">✓ All players have been auctioned!</p>
              <p className="text-sm">No pending or unsold players remaining.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 max-w-6xl mx-auto">
            {availablePlayers.map((player) => (
              <div
                key={player.id}
                className="bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 p-4 transition-colors"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  {/* Left: Player Info */}
                  <div className="flex-1 min-w-0 flex items-start gap-3">
                    <PlayerAvatar name={player.name} photoUrl={player.photoUrl} size="md" />
                    <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-bold text-white truncate">
                        {player.name}
                      </h3>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${ROLE_COLORS[player.role] || 'bg-gray-700'}`}>
                        {player.role}
                      </span>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${STATUS_COLORS[player.status] || 'bg-gray-700'}`}>
                        {player.status === 'pending' ? '⏳ Pending' : '❌ Unsold'}
                      </span>
                    </div>

                    <div className="text-sm text-gray-400">
                      <span className="inline-block mr-4">
                        Base Price: <span className="text-yellow-400 font-semibold">{player.basePrice}</span> pts
                      </span>
                      {role === 'admin' && player.soldTo && (
                        <span className="inline-block">
                          Team: <span className="text-blue-300 font-semibold">{teamsMap.get(player.soldTo)?.name || player.soldTo}</span>
                        </span>
                      )}
                    </div>

                    {/* Admin-only details */}
                    {role === 'admin' && (
                      <div className="text-xs text-gray-500 mt-2">
                        <div>Player ID: {player.id}</div>
                        {player.soldPrice && (
                          <div>
                            Last Sold Price: <span className="text-green-400">{player.soldPrice}</span> pts
                          </div>
                        )}
                      </div>
                    )}
                    </div>
                  </div>

                  {/* Right: Quick Stats */}
                  <div className="flex flex-col items-end gap-2 text-right">
                    <div className="bg-gray-900 rounded px-2 py-1">
                      <div className="text-xs text-gray-500">Base</div>
                      <div className="text-lg font-bold text-yellow-400">{player.basePrice}</div>
                    </div>
                    {player.status === 'unsold' && role === 'admin' && (
                      <div className="text-xs text-red-400 bg-red-900 bg-opacity-30 rounded px-2 py-1">
                        Previously unsold
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .btn-primary {
          background: #2563eb;
          color: white;
          padding: 0.5rem 1.25rem;
          border-radius: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          border: none;
        }
        .btn-primary:hover {
          background: #1d4ed8;
        }
      `}</style>
    </div>
  )
}
