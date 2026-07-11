import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  loadAuctionState,
  syncOnlineAuctionProgress,
  loadOnlineLiveSnapshot,
} from '../hooks/useAuctionStorage'
import { useOnlineAuction } from '../hooks/useOnlineAuction'
import PlayerAvatar from '../components/PlayerAvatar'
import PlayerSpotlight from '../components/PlayerSpotlight'
import Icon from '../components/Icon'
import TimerRing from '../components/TimerRing'

const ROLE_COLORS = {
  Batsman: 'bg-blue-700',
  Bowler: 'bg-green-700',
  'All-rounder': 'bg-purple-700',
  'All Rounder': 'bg-purple-700',
  'Wicket-keeper': 'bg-orange-700',
  'Super Striker': 'bg-rose-600',
  PLAYER: 'bg-slate-600',
}

export default function AdminOnline() {
  const navigate = useNavigate()
  const saved = loadAuctionState()
  const [roomReady, setRoomReady] = useState(false)
  const [roomCode] = useState(saved?.roomCode || null)
  const [bootstrapError, setBootstrapError] = useState('')
  const [expandedTeamId, setExpandedTeamId] = useState(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [restored, setRestored] = useState(false)
  const [disconnectAlert, setDisconnectAlert] = useState(null) // { teamName, at }

  // Smart mount: check if room exists → restore from snapshot if not → create fresh if no snapshot
  useEffect(() => {
    if (!saved || !saved.roomCode) return
    const rc = saved.roomCode
    fetch(`/api/auction/${rc}/state`)
      .then(r => {
        if (r.ok) { setRoomReady(true); return }
        const liveSnapshot = loadOnlineLiveSnapshot()
        if (liveSnapshot && liveSnapshot.roomCode === rc) {
          return fetch('/api/auction/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomCode: rc, snapshot: liveSnapshot.state, originalSetup: saved, adminToken: saved.adminToken }),
          }).then(async (resp) => {
            const data = await resp.json().catch(() => ({}))
            if (!resp.ok) throw new Error(data.error || 'Restore failed')
            setRestored(true)
            setRoomReady(true)
          })
        }
        return fetch('/api/auction/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomCode: rc, auctionData: saved }),
        }).then(async (resp) => {
          const data = await resp.json().catch(() => ({}))
          if (!resp.ok) throw new Error(data.error || 'Failed to create room')
          setRoomReady(true)
        })
      })
      .catch((err) => {
        setBootstrapError(err?.message || 'Failed to initialize room')
      })
  }, [])

  const activeRoomCode = roomReady ? roomCode : null

  const {
    state, currentPlayer, leadingTeam,
    adminNextPlayer, adminUndoBid, adminFinish, adminSold, adminReopenSold, adminUndoSold, adminReturnSoldToQueue, adminUnsold, adminRequeueUnsold, adminKickTeam, adminPause, adminResume, adminAutoAssignUnsold,
  } = useOnlineAuction({ roomCode: activeRoomCode, role: 'admin', teamId: null })

  // Persist online auction progress (snapshot + results payload sync)
  useEffect(() => {
    syncOnlineAuctionProgress({ roomCode, state })
  }, [roomCode, state.status, state.teams, state.players, state.config])

  // Flash disconnect alert when a captain drops mid-auction
  const prevConnectedRef = React.useRef(state.connectedTeamIds)
  useEffect(() => {
    const prev = prevConnectedRef.current
    const curr = state.connectedTeamIds
    const dropped = prev.filter(id => !curr.includes(id))
    if (dropped.length > 0 && (state.status === 'running')) {
      const team = state.teams.find(t => t.id === dropped[0])
      setDisconnectAlert({ teamName: team?.name || dropped[0], at: Date.now() })
      setTimeout(() => setDisconnectAlert(null), 8000)
    }
    prevConnectedRef.current = curr
  }, [state.connectedTeamIds])

  const downloadSnapshot = useCallback(() => {
    const data = { version: 1, roomCode, savedAt: new Date().toISOString(), state, originalSetup: saved }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `auction-${roomCode}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [roomCode, state, saved])

  if (!saved) {
    return (
      <div className="app-shell text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">No auction configured.</p>
          <button onClick={() => navigate('/setup/online')} className="btn-primary">Set up auction</button>
        </div>
      </div>
    )
  }

  if (!roomReady) {
    return (
      <div className="app-shell text-white flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold mb-3">Preparing Auction Room…</h2>
          {bootstrapError ? (
            <>
              <p className="text-red-400 text-sm mb-4">{bootstrapError}</p>
              <button onClick={() => window.location.reload()} className="btn-primary">Retry</button>
            </>
          ) : (
            <p className="text-gray-400 text-sm">Reconnecting to room <span className="font-mono text-yellow-400">{roomCode}</span></p>
          )}
        </div>
      </div>
    )
  }

  const { status, teams, bids, timerLeft, config } = state
  const soldCount = state.players.filter(p => p.status === 'sold').length
  const totalPlayers = state.players.length
  const joinUrl = `${window.location.origin}/join/${roomCode}`
  const totalTeams = teams.length || saved?.teams?.length || config.numTeams || 0

  if (status === 'finished') {
    return (
      <div className="app-shell text-white flex flex-col items-center justify-center gap-6 p-6">
        <h2 className="text-3xl font-bold">Auction Complete!</h2>
        <p className="text-gray-400">{soldCount} of {totalPlayers} players sold</p>
        {state.canUndoSold && (
          <div className="flex gap-2">
            <button onClick={() => { if (window.confirm('Reopen bidding for the last sold player? This will remove the player from the team and restore the winning bid.')) adminReopenSold() }} className="bg-blue-700 hover:bg-blue-600 text-white font-bold px-4 py-2 rounded-xl text-sm inline-flex items-center gap-1.5">
              <Icon name="reopen" size={15} /> Reopen Last Sold
            </button>
            <button onClick={() => { if (window.confirm('Move the last sold player to unsold? This will remove the player from the team and refund the sale.')) adminUndoSold() }} className="bg-yellow-700 hover:bg-yellow-600 text-white font-bold px-4 py-2 rounded-xl text-sm inline-flex items-center gap-1.5">
              <Icon name="undo" size={15} /> Last Sold to Unsold
            </button>
          </div>
        )}
        <div className="w-full max-w-2xl space-y-3">
          {teams.map(team => (
            <div key={team.id} className="auction-surface rounded-xl p-4 text-left">
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
                        onClick={() => { if (window.confirm(`Return ${player.name} to the auction queue? This removes the player from ${team.name} and refunds the sale.`)) adminReturnSoldToQueue(player.id) }}
                        className="text-cyan-300 border border-cyan-800 rounded px-2 py-1 hover:text-white inline-flex items-center gap-1"
                      >
                        <Icon name="reopen" size={13} /> Return to Queue
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
              <button onClick={adminAutoAssignUnsold} className="bg-purple-700 hover:bg-purple-600 text-white font-bold text-lg px-8 py-4 rounded-2xl shadow-lg shadow-purple-900 transition-all hover:scale-105 cursor-pointer inline-flex items-center gap-2">
                <Icon name="shuffle" size={20} /> Auto-Assign Remaining
              </button>
              <button onClick={adminRequeueUnsold} className="btn-secondary">Re-auction unsold</button>
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
    <div className="app-shell text-white flex flex-col">
      {/* Top bar */}
      <div className="auction-topbar border-b border-gray-800 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="font-bold text-lg">Admin Console</span>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">ONLINE</span>
          <span className={`text-xs px-2 py-1 rounded ${state.connected ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
            {state.connected ? '● Live' : '○ Connecting…'}
          </span>
          {restored && (
            <span className="text-xs bg-green-900 text-green-300 px-2 py-1 rounded font-semibold inline-flex items-center gap-1"><Icon name="check" size={12} strokeWidth={2.5} /> Restored</span>
          )}
          {state.secondRound && (
            <span className="text-xs bg-orange-700 text-orange-100 px-2 py-1 rounded font-semibold inline-flex items-center gap-1"><Icon name="refresh" size={12} /> Unsold Round</span>
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
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 bg-green-700 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-50 inline-flex items-center gap-1">
                <Icon name="check" size={12} strokeWidth={2.5} /> Link copied!
              </div>
            )}
          </div>
          <span className="text-xs text-gray-500">{soldCount}/{totalPlayers} sold</span>
          <button
            onClick={() => window.open(`/watch/${roomCode}`, '_blank')}
            title="Open viewer display (stream this on YouTube)"
            className="text-purple-400 hover:text-white text-xs border border-purple-800 px-2 py-1 rounded inline-flex items-center gap-1"
          >
            <Icon name="tv" size={13} /> Viewer
          </button>
          <button
            onClick={() => window.open(`/available/${roomCode}`, '_blank')}
            title="View available players (pending & unsold)"
            className="text-cyan-400 hover:text-white text-xs border border-cyan-800 px-2 py-1 rounded inline-flex items-center gap-1"
          >
            <Icon name="list" size={13} /> Available
          </button>
          <button
            onClick={downloadSnapshot}
            title="Save snapshot (for manual recovery)"
            className="text-gray-400 hover:text-white text-xs border border-gray-700 px-2 py-1 rounded inline-flex items-center gap-1"
          >
            <Icon name="save" size={13} /> Save
          </button>
          {status !== 'idle' && status !== 'finished' && (
            <button
              onClick={() => { if (window.confirm('End the auction now? Any players not yet sold will be marked unsold (you can still auto-assign or re-auction them).')) adminFinish() }}
              className="text-red-400 hover:text-red-300 text-xs border border-red-800 px-2 py-1 rounded inline-flex items-center gap-1"
            >
              <Icon name="stop" size={13} /> Finish
            </button>
          )}
        </div>
      </div>

      {/* Captain disconnect alert */}
      {disconnectAlert && (
        <div className="bg-red-700 border-b border-red-500 px-4 py-2 flex items-center justify-between gap-4 animate-pulse">
          <span className="text-white font-semibold text-sm inline-flex items-center gap-1.5">
            <Icon name="warning" size={15} /> <strong>{disconnectAlert.teamName}</strong> disconnected mid-auction! Pause if you want to wait for them to rejoin.
          </span>
          <button onClick={state.paused ? adminResume : adminPause} className="bg-white text-red-700 text-xs font-bold px-3 py-1 rounded-lg shrink-0 inline-flex items-center gap-1">
            {state.paused ? <><Icon name="play" size={12} /> Resume</> : <><Icon name="pause" size={12} /> Pause</>}
          </button>
        </div>
      )}

      {state.sessionError && (
        <div className="bg-red-900/80 border-b border-red-700 px-4 py-2 flex items-center justify-between gap-4">
          <span className="text-red-200 text-sm">
            Admin session error: {state.sessionError}
          </span>
          <button
            onClick={() => window.location.reload()}
            className="bg-white text-red-700 text-xs font-bold px-3 py-1 rounded-lg shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: current player + controls ── */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          {(status === 'idle') && (
            <div className="text-center">
              <p className="text-gray-400 mb-2">Share the join link with captains, then start.</p>
              <p className="font-mono text-blue-300 text-sm mb-6 break-all">{joinUrl}</p>
              <div className="mb-4 space-y-1">
                {state.teams.map(team => {
                  const isOnline = state.connectedTeamIds.includes(team.id)
                  return (
                    <div key={team.id} className="flex items-center justify-center gap-2 text-sm">
                      <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400' : 'bg-gray-600'}`} />
                      <span className={isOnline ? 'text-white' : 'text-gray-500'}>{team.name}</span>
                      <span className="text-xs text-gray-600">{isOnline ? 'Ready' : 'Waiting…'}</span>
                    </div>
                  )
                })}
              </div>
              {state.connectedTeamIds.length < totalTeams && (
                <p className="text-yellow-500 text-xs mb-3">
                  Waiting for {totalTeams - state.connectedTeamIds.length} more captain{totalTeams - state.connectedTeamIds.length !== 1 ? 's' : ''} to join…
                </p>
              )}
              <button
                onClick={adminNextPlayer}
                disabled={state.connectedTeamIds.length < totalTeams}
                className={`btn-primary text-xl px-10 py-4 transition-opacity inline-flex items-center gap-2 ${state.connectedTeamIds.length < totalTeams ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <Icon name="play" size={20} /> Start Auction
              </button>
              {state.connectedTeamIds.length < totalTeams && (
                <p className="text-gray-600 text-xs mt-2">All captains must connect before the auction can begin</p>
              )}
            </div>
          )}

          {(status === 'running' || status === 'sold' || status === 'unsold') && currentPlayer && (
            <div className="w-full flex-1 max-w-[112rem] mx-auto flex flex-col xl:flex-row gap-6 xl:items-stretch py-2">
              {/* Player showcase */}
              <div className="auction-surface rounded-3xl p-8 xl:p-10 text-center w-full xl:flex-[3] shadow-2xl border border-gray-700 flex flex-col items-center justify-center gap-4">
                <PlayerSpotlight key={currentPlayer.id} name={currentPlayer.name} photoUrl={currentPlayer.photoUrl} />
                <div className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold ${ROLE_COLORS[currentPlayer.role] || 'bg-gray-700'}`}>
                  {currentPlayer.role}
                </div>
                <h2 className="text-5xl xl:text-6xl font-extrabold leading-tight">{currentPlayer.name}</h2>
                <p className="text-gray-400 text-lg">Base: {currentPlayer.basePrice} pts</p>

                <div className="auction-surface-soft rounded-2xl px-8 py-6 w-full max-w-2xl">
                  <p className="text-sm text-gray-400 mb-1 uppercase tracking-[0.25em]">Current Bid</p>
                  <p className="text-8xl xl:text-9xl font-black text-yellow-400 leading-none">{state.currentPrice}</p>
                  {leadingTeam && <p className="text-4xl text-blue-300 mt-4 font-extrabold inline-flex items-center gap-2 justify-center"><Icon name="flame" size={28} /> {leadingTeam.name}</p>}
                  {!leadingTeam && status === 'running' && <p className="text-lg text-gray-500 mt-3">No bids yet</p>}
                </div>

                {config.timerEnabled && status === 'running' && (
                  <TimerRing seconds={timerLeft} total={config.timerSeconds} paused={state.paused} size={140} />
                )}

                {status === 'sold' && (
                  <div className="bg-green-800 rounded-xl px-6 py-3 text-green-100 font-bold text-2xl inline-flex items-center justify-center gap-2.5 w-full max-w-2xl">
                    <Icon name="check" size={26} strokeWidth={2.5} /> SOLD to {leadingTeam?.name}
                  </div>
                )}
                {status === 'unsold' && (
                  <div className="bg-red-900 rounded-xl px-6 py-3 text-red-100 font-bold text-2xl inline-flex items-center justify-center gap-2.5 w-full max-w-2xl">
                    <Icon name="x" size={26} strokeWidth={2.5} /> UNSOLD
                  </div>
                )}
              </div>

              {/* Controls column */}
              <div className="w-full xl:flex-[2] flex flex-col justify-center items-center gap-4">
                {status === 'running' && !config.timerEnabled && (
                  <div className="w-full max-w-sm grid grid-cols-2 gap-3">
                    <button onClick={adminSold} disabled={!leadingTeam || state.paused} className="bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl py-3.5 font-bold text-base inline-flex items-center justify-center gap-2">
                      <Icon name="check" size={18} strokeWidth={2.5} /> Sold
                    </button>
                    <button onClick={adminUnsold} disabled={state.paused} className="bg-red-800 hover:bg-red-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl py-3.5 font-bold text-base inline-flex items-center justify-center gap-2">
                      <Icon name="x" size={18} strokeWidth={2.5} /> Unsold
                    </button>
                    <button onClick={adminUndoBid} disabled={!bids.length || state.paused} className="col-span-2 bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl py-3.5 font-bold text-base inline-flex items-center justify-center gap-2">
                      <Icon name="undo" size={18} /> Undo
                    </button>
                  </div>
                )}
                {status === 'running' && config.timerEnabled && (
                  <button onClick={adminUndoBid} disabled={!bids.length || state.paused} className="w-full max-w-sm bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl py-3.5 font-bold text-base inline-flex items-center justify-center gap-2">
                    <Icon name="undo" size={18} /> Undo Last Bid
                  </button>
                )}

                {status === 'running' && (
                  <button
                    onClick={state.paused ? adminResume : adminPause}
                    className={`w-full max-w-sm rounded-xl py-3.5 font-bold text-base inline-flex items-center justify-center gap-2 ${state.paused ? 'bg-green-700 hover:bg-green-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-yellow-300'}`}
                  >
                    {state.paused ? <><Icon name="play" size={18} /> Resume Auction</> : <><Icon name="pause" size={18} /> Pause Auction</>}
                  </button>
                )}

                {state.paused && status === 'running' && (
                  <div className="w-full max-w-sm bg-yellow-900/50 border border-yellow-700 rounded-xl px-5 py-3 text-yellow-300 text-base font-semibold text-center inline-flex items-center justify-center gap-2">
                    <Icon name="pause" size={18} /> Auction Paused — Bidding disabled
                  </div>
                )}

                {status === 'running' && (
                  <p className="text-sm text-gray-500 text-center max-w-sm">Captains bid from their own devices. Winner is set automatically {config.timerEnabled ? 'when the timer ends' : 'when you mark Sold'}.</p>
                )}

                {(status === 'sold' || status === 'unsold') && (
                  <div className="w-full max-w-sm flex flex-col gap-3">
                    {status === 'sold' && state.canUndoSold && (
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => { if (window.confirm('Reopen bidding for this sold player? This will remove the player from the team and restore the winning bid.')) adminReopenSold() }}
                          className="bg-blue-700 hover:bg-blue-600 text-white rounded-xl py-3.5 font-bold text-sm inline-flex items-center justify-center gap-2"
                        >
                          <Icon name="reopen" size={16} /> Reopen
                        </button>
                        <button
                          onClick={() => { if (window.confirm('Move this sold player to unsold? This will remove the player from the team and refund the sale.')) adminUndoSold() }}
                          className="bg-yellow-700 hover:bg-yellow-600 text-white rounded-xl py-3.5 font-bold text-sm inline-flex items-center justify-center gap-2"
                        >
                          <Icon name="undo" size={16} /> To Unsold
                        </button>
                      </div>
                    )}
                    <button
                      onClick={adminNextPlayer}
                      disabled={state.connectedTeamIds.length < totalTeams}
                      className={`btn-primary w-full py-4 text-lg transition-opacity ${state.connectedTeamIds.length < totalTeams ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      Next Player →
                    </button>
                    {state.connectedTeamIds.length < totalTeams && (
                      <div className="bg-yellow-900/40 border border-yellow-700 rounded-xl px-4 py-3 text-sm w-full">
                        <p className="text-yellow-300 font-semibold mb-1.5 inline-flex items-center gap-1.5"><Icon name="warning" size={15} /> Captain connection status</p>
                        {teams.map(team => {
                          const online = state.connectedTeamIds.includes(team.id)
                          return (
                            <div key={team.id} className="flex items-center gap-1.5 py-0.5">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${online ? 'bg-green-400' : 'bg-red-500'}`} />
                              <span className={online ? 'text-green-300' : 'text-red-300'}>{team.name}</span>
                              <span className={`ml-auto font-medium ${online ? 'text-green-400' : 'text-red-400'}`}>{online ? 'Connected' : 'Disconnected'}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: teams + bid log ── */}
        <div className="w-72 lg:w-80 2xl:w-96 auction-surface border-l border-gray-800 flex flex-col" style={{height: 'calc(100vh - 57px)'}}>
          {/* Teams — always fully visible */}
          <div className="p-4 border-b border-gray-800 shrink-0">
            <p className="text-sm text-gray-400 uppercase tracking-widest mb-3">Teams</p>
            <div className="space-y-2">
              {teams.map(team => {
                const total = saved.config.pointsPerTeam || 1
                const spentPct = Math.round(((total - team.budget) / total) * 100)
                const isOnline = state.connectedTeamIds.includes(team.id)
                const isLeading = state.leadingTeamId === team.id
                const isExpanded = expandedTeamId === team.id
                return (
                  <div key={team.id} className={`rounded-lg overflow-hidden ${isLeading ? 'ring-1 ring-blue-500' : ''}`}>
                    {/* Team header row — click to expand */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setExpandedTeamId(isExpanded ? null : team.id)
                        }
                      }}
                      className={`w-full px-3 pt-2.5 pb-1.5 text-left transition-colors ${
                        isLeading ? 'bg-blue-900/60' : 'bg-gray-800 hover:bg-gray-750'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? 'bg-green-400' : 'bg-gray-600'}`} />
                          <span className="text-base font-semibold truncate">{team.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-yellow-400 font-bold">{team.budget}<span className="text-gray-500 font-normal"> pts</span></span>
                          {isOnline && (
                            <button
                              onClick={(e) => { e.stopPropagation(); if (window.confirm(`Kick ${team.name} from the auction?`)) adminKickTeam(team.id) }}
                              title="Kick this captain"
                              aria-label={`Kick ${team.name}`}
                              className="text-red-500 hover:text-red-300 leading-none px-1"
                            ><Icon name="x" size={14} /></button>
                          )}
                          <span className="text-gray-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-2 mb-1" title={`${spentPct}% of budget used`}>
                        <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${spentPct}%` }} />
                      </div>
                      <p className="text-xs text-gray-500">{team.players.length} player{team.players.length !== 1 ? 's' : ''}</p>
                    </div>
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
                                        adminReturnSoldToQueue(p.id)
                                      }
                                    }}
                                    className="text-cyan-300 hover:text-white border border-cyan-900 rounded px-1.5 py-0.5"
                                    aria-label={`Return ${p.name} to queue`}
                                  >
                                    <Icon name="reopen" size={12} />
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
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-gray-400 uppercase tracking-widest">Live Bid Feed</p>
              {bids.length > 0 && <span className="text-xs text-gray-500">{bids.length} bid{bids.length !== 1 ? 's' : ''}</span>}
            </div>
            {currentPlayer && (
              <p className="text-sm text-blue-400 font-medium mb-3 truncate">{currentPlayer.name}</p>
            )}
            {bids.length === 0 && <p className="text-sm text-gray-600">No bids yet — waiting for the first bid.</p>}
            <div className="space-y-1.5">
              {bids.slice(0, 30).map((b, i) => {
                const team = teams.find(t => t.id === b.teamId)
                const prevPrice = bids[i + 1]?.price
                const inc = prevPrice != null ? b.price - prevPrice : null
                const isLatest = i === 0
                return (
                  <div key={i} className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm ${isLatest ? 'bg-blue-900/40 ring-1 ring-blue-700/60' : 'bg-gray-800/40'}`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isLatest && <Icon name="flame" size={14} className="text-blue-300 shrink-0" />}
                      <span className={`truncate ${isLatest ? 'text-blue-100 font-semibold' : 'text-gray-300'}`}>{team?.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {inc != null && inc > 0 && <span className="text-emerald-400/80 font-mono text-xs">+{inc}</span>}
                      <span className={`font-mono font-semibold ${isLatest ? 'text-yellow-300' : 'text-yellow-400/80'}`}>{b.price}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
