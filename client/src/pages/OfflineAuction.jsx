import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOfflineAuction } from '../hooks/useOfflineAuction'
import { loadAuctionState } from '../hooks/useAuctionStorage'
import { getIncrement } from '../utils/bidTiers'
import PlayerAvatar from '../components/PlayerAvatar'
import PlayerSpotlight from '../components/PlayerSpotlight'
import Icon from '../components/Icon'
import TimerRing from '../components/TimerRing'

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
      <div className="app-shell text-white flex items-center justify-center">
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
      <div className="app-shell text-white flex flex-col items-center justify-center gap-6 p-6">
        <h2 className="text-3xl font-bold">Auction Complete!</h2>
        <p className="text-gray-400">{soldCount} of {totalPlayers} players sold</p>
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
                        onClick={() => { if (window.confirm(`Return ${player.name} to the auction queue? This removes the player from ${team.name} and refunds the sale.`)) returnSoldToQueue(player.id) }}
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
              <button onClick={autoAssignUnsold} className="bg-purple-700 hover:bg-purple-600 text-white font-bold text-lg px-8 py-4 rounded-2xl shadow-lg shadow-purple-900 transition-all hover:scale-105 cursor-pointer inline-flex items-center gap-2">
                <Icon name="shuffle" size={20} /> Auto-Assign Remaining
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
    <div className="app-shell text-white flex flex-col" style={{ minHeight: '100dvh' }}>
      {/* Top bar */}
      <div className="auction-topbar border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-bold text-lg">Auction Console</span>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">OFFLINE</span>
          {state.secondRound && (
            <span className="text-xs bg-orange-700 text-orange-100 px-2 py-1 rounded font-semibold inline-flex items-center gap-1"><Icon name="refresh" size={12} /> Unsold Round</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>{soldCount}/{totalPlayers} sold</span>
          <span>{queueLeft} in queue</span>
          {status !== 'idle' && !paused && (
            <button onClick={pause} className="text-yellow-400 hover:text-yellow-300 text-xs border border-yellow-700 px-2 py-1 rounded inline-flex items-center gap-1"><Icon name="pause" size={12} /> Pause</button>
          )}
          {paused && (
            <button onClick={resume} className="text-green-400 hover:text-green-300 text-xs border border-green-700 px-2 py-1 rounded inline-flex items-center gap-1"><Icon name="play" size={12} /> Resume</button>
          )}
          {status !== 'idle' && status !== 'finished' && (
            <button
              onClick={() => { if (window.confirm('End the auction now? Remaining players will be skipped.')) finishAuction() }}
              className="text-red-400 hover:text-red-300 text-xs border border-red-800 px-2 py-1 rounded inline-flex items-center gap-1"
            >
              <Icon name="stop" size={12} /> Finish
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
                Start Auction
              </button>
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

                {/* Current bid */}
                <div className="auction-surface-soft rounded-2xl px-8 py-6 w-full max-w-2xl">
                  <p className="text-sm text-gray-400 mb-1 uppercase tracking-[0.25em]">Current Bid</p>
                  <p className="text-8xl xl:text-9xl font-black text-yellow-400 leading-none">{state.currentPrice}</p>
                  {leadingTeam && (
                    <p className="text-4xl font-extrabold text-blue-300 mt-4">{leadingTeam.name}</p>
                  )}
                  {!leadingTeam && status === 'running' && (
                    <p className="text-lg text-gray-500 mt-3">No bids yet</p>
                  )}
                </div>

                {/* Timer */}
                {config.timerEnabled && status === 'running' && (
                  <TimerRing seconds={timerLeft} total={config.timerSeconds} paused={paused} size={140} />
                )}

                {/* Status badges */}
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

              {/* Auctioneer controls */}
              <div className="w-full xl:flex-[2] flex flex-col justify-center gap-4">
                {status === 'running' && (
                  <>
                    {/* Bid buttons per team */}
                    <p className="text-sm text-gray-400 text-center uppercase tracking-[0.25em]">Click when a team bids</p>
                    <div className="grid grid-cols-2 gap-4">
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
                            className={`team-bid-btn rounded-2xl py-6 px-4 font-bold transition-all ${
                              canBid
                                ? ''
                                : rosterFull
                                  ? 'is-full cursor-not-allowed'
                                  : state.leadingTeamId === team.id
                                    ? 'is-leading cursor-not-allowed'
                                    : 'is-blocked cursor-not-allowed'
                            }`}
                          >
                            <span className="block text-2xl leading-tight">{team.name}</span>
                            {rosterFull ? (
                              <span className="block text-sm font-normal mt-1.5 inline-flex items-center gap-1 justify-center"><Icon name="ban" size={14} /> Roster Full</span>
                            ) : state.leadingTeamId === team.id ? (
                              <span className="block text-sm font-normal mt-1.5 inline-flex items-center gap-1 justify-center"><Icon name="flame" size={14} /> Leading</span>
                            ) : (
                              <>
                                <span className="block text-sm font-normal mt-1.5 opacity-80">{team.budget} pts left</span>
                                <span className="block text-xs font-normal opacity-60">After bid: {team.budget - nextPrice} pts</span>
                              </>
                            )}
                          </button>
                        )
                      })}
                    </div>
                    {/* Sold / Unsold / Undo */}
                    <div className="grid grid-cols-3 gap-4 mt-1">
                      <button
                        onClick={markSold}
                        disabled={!leadingTeam}
                        className="bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-2xl py-5 font-bold text-lg inline-flex items-center justify-center gap-2"
                      >
                        <Icon name="check" size={20} strokeWidth={2.5} /> Sold
                      </button>
                      <button
                        onClick={markUnsold}
                        className="bg-red-800 hover:bg-red-700 text-white rounded-2xl py-5 font-bold text-lg inline-flex items-center justify-center gap-2"
                      >
                        <Icon name="x" size={20} strokeWidth={2.5} /> Unsold
                      </button>
                      <button
                        onClick={undoBid}
                        disabled={!bids.length}
                        className="bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-2xl py-5 font-bold text-lg inline-flex items-center justify-center gap-2"
                      >
                        <Icon name="undo" size={18} /> Undo
                      </button>
                    </div>
                  </>
                )}

                {(status === 'sold' || status === 'unsold') && (
                  <div className="flex flex-col items-center gap-4">
                    {status === 'sold' && (
                      <div className="flex gap-3 flex-wrap justify-center">
                        <button onClick={() => { if (window.confirm('Reopen bidding for this sold player? This will remove the player from the team and restore the winning bid.')) reopenSold() }} className="bg-blue-700 hover:bg-blue-600 text-white rounded-2xl py-3 px-6 font-bold text-base inline-flex items-center gap-2">
                          <Icon name="reopen" size={18} /> Reopen Bidding
                        </button>
                        <button onClick={() => { if (window.confirm('Move this sold player to unsold? This will remove the player from the team and refund the sale.')) soldToUnsold() }} className="bg-yellow-700 hover:bg-yellow-600 text-white rounded-2xl py-3 px-6 font-bold text-base inline-flex items-center gap-2">
                          <Icon name="undo" size={18} /> To Unsold
                        </button>
                      </div>
                    )}
                    <button onClick={nextPlayer} className="btn-primary text-2xl px-14 py-6">
                      Next Player →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Right panel: Teams & Bid log ── */}
        <div className="w-72 lg:w-80 2xl:w-96 auction-surface border-l border-gray-800 flex flex-col" style={{height: 'calc(100vh - 57px)'}}>
          {/* Teams — always fully visible */}
          <div className="p-4 border-b border-gray-800 shrink-0">
            <p className="text-sm text-gray-400 uppercase tracking-widest mb-3">Teams</p>
            <div className="space-y-2">
              {teams.map(team => {
                const total = saved.config.pointsPerTeam || 1
                const spentPct = Math.round(((total - team.budget) / total) * 100)
                const isExpanded = expandedTeamId === team.id
                const isLeading = state.leadingTeamId === team.id
                return (
                  <div key={team.id} className={`rounded-lg overflow-hidden ${isLeading ? 'ring-1 ring-blue-500' : ''}`}>
                    {/* Team header row — click to expand */}
                    <button
                      onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                      className={`w-full px-3 pt-2.5 pb-1.5 text-left transition-colors ${
                        isLeading ? 'bg-blue-900/60' : 'bg-gray-800 hover:bg-gray-750'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-base font-semibold truncate">{team.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-yellow-400 font-bold">{team.budget}<span className="text-gray-500 font-normal"> pts</span></span>
                          <span className="text-gray-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-2 mb-1" title={`${spentPct}% of budget used`}>
                        <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${spentPct}%` }} />
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
