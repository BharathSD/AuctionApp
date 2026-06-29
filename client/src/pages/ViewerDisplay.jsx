import { useEffect, useReducer, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { io } from 'socket.io-client'
import PlayerAvatar from '../components/PlayerAvatar'

const ROLE_COLORS = {
  Batsman: 'bg-blue-600',
  Bowler: 'bg-green-600',
  'All-rounder': 'bg-purple-600',
  'Wicket-keeper': 'bg-orange-500',
}

const ROLE_TEXT = {
  Batsman: 'text-blue-300',
  Bowler: 'text-green-300',
  'All-rounder': 'text-purple-300',
  'Wicket-keeper': 'text-orange-300',
}

function reducer(state, action) {
  switch (action.type) {
    case 'STATE_UPDATE': return { ...state, ...action.payload, connected: true }
    case 'BID_ACCEPTED': return {
      ...state,
      currentPrice: action.payload.price,
      leadingTeamId: action.payload.teamId,
      timerLeft: action.payload.timerLeft ?? state.timerLeft,
      bidFlash: true,
    }
    case 'TIMER_TICK': return { ...state, timerLeft: action.payload.timerLeft }
    case 'CLEAR_FLASH': return { ...state, bidFlash: false }
    case 'SET_CONNECTED': return { ...state, connected: action.payload }
    default: return state
  }
}

const INITIAL = {
  connected: false, status: 'idle', currentPrice: null, leadingTeamId: null,
  timerLeft: null, teams: [], players: [], queue: [], currentIdx: -1,
  bids: [], config: {}, secondRound: false, bidFlash: false,
}

export default function ViewerDisplay() {
  const { roomCode } = useParams()
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const socketRef = useRef(null)

  useEffect(() => {
    const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] })
    socketRef.current = socket
    socket.on('connect', () => {
      dispatch({ type: 'SET_CONNECTED', payload: true })
      socket.emit('viewer:join', { roomCode })
    })
    socket.on('disconnect', () => dispatch({ type: 'SET_CONNECTED', payload: false }))
    socket.on('auction:stateUpdate', d => dispatch({ type: 'STATE_UPDATE', payload: d }))
    socket.on('auction:playerStart', d => dispatch({ type: 'STATE_UPDATE', payload: d }))
    socket.on('auction:secondRound', d => dispatch({ type: 'STATE_UPDATE', payload: d }))
    socket.on('auction:sold', d => dispatch({ type: 'STATE_UPDATE', payload: d }))
    socket.on('auction:unsold', d => dispatch({ type: 'STATE_UPDATE', payload: d }))
    socket.on('auction:finished', d => dispatch({ type: 'STATE_UPDATE', payload: d }))
    socket.on('bid:accepted', d => {
      dispatch({ type: 'BID_ACCEPTED', payload: d })
      setTimeout(() => dispatch({ type: 'CLEAR_FLASH' }), 600)
    })
    socket.on('timer:tick', d => dispatch({ type: 'TIMER_TICK', payload: d }))
    return () => socket.disconnect()
  }, [roomCode])

  const { status, teams, currentIdx, queue, players, currentPrice,
    leadingTeamId, timerLeft, config, secondRound, bidFlash, connected } = state

  const currentPlayer = queue[currentIdx] !== undefined ? players[queue[currentIdx]] : null
  const leadingTeam = teams.find(t => t.id === leadingTeamId) || null
  const soldCount = players.filter(p => p.status === 'sold').length
  const totalPlayers = players.length

  const timerPct = config.timerEnabled && config.timerSeconds
    ? Math.max(0, (timerLeft / config.timerSeconds) * 100) : 100
  const timerColor = timerLeft > 10 ? 'bg-green-500' : timerLeft > 5 ? 'bg-yellow-400' : 'bg-red-500'

  // Recently sold players (last 5)
  const recentSold = players
    .filter(p => p.status === 'sold')
    .sort((a, b) => (Number(b.soldAt) || 0) - (Number(a.soldAt) || 0))
    .slice(0, 5)

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col overflow-hidden"
      style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── Top bar ── */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl font-extrabold tracking-tight">🏏 Cricket Auction</span>
          {secondRound && (
            <span className="text-xs bg-orange-700 text-orange-100 px-2 py-0.5 rounded font-semibold">🔁 UNSOLD ROUND</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>{soldCount} / {totalPlayers} players sold</span>
          <button
            onClick={() => window.open(`/available/${roomCode}`, '_blank')}
            title="View available players (pending & unsold)"
            className="text-cyan-400 hover:text-white text-xs border border-cyan-800 px-2 py-0.5 rounded"
          >
            📋 Available
          </button>
          <span className={`text-xs px-2 py-0.5 rounded ${connected ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
            {connected ? '● LIVE' : '○ Connecting…'}
          </span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: current player + bid ── */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6">

          {status === 'idle' && (
            <div className="text-center">
              <div className="text-8xl mb-6">🏏</div>
              <p className="text-3xl font-bold text-gray-300">Auction Starting Soon</p>
              <p className="text-gray-500 mt-2">Room: <span className="font-mono text-yellow-400">{roomCode}</span></p>
            </div>
          )}

          {status === 'finished' && (
            <div className="text-center">
              <div className="text-8xl mb-6">🏆</div>
              <p className="text-4xl font-extrabold text-yellow-400">Auction Complete!</p>
              <p className="text-gray-400 mt-3 text-xl">{soldCount} of {totalPlayers} players sold</p>
            </div>
          )}

          {(status === 'running' || status === 'sold' || status === 'unsold') && currentPlayer && (
            <>
              {/* Player card */}
              <div className={`rounded-3xl p-8 text-center w-full max-w-lg shadow-2xl border transition-all duration-300
                ${status === 'sold' ? 'bg-green-900/40 border-green-600' :
                  status === 'unsold' ? 'bg-gray-800 border-gray-600' :
                  bidFlash ? 'bg-blue-900/50 border-blue-400 scale-[1.02]' : 'bg-gray-800/80 border-gray-700'}`}>

                <PlayerAvatar name={currentPlayer.name} photoUrl={currentPlayer.photoUrl} size="3xl" className="mx-auto mb-4" />

                {/* Role badge */}
                <span className={`inline-block text-xs font-bold px-3 py-1 rounded-full mb-4 text-white
                  ${ROLE_COLORS[currentPlayer.role] || 'bg-gray-600'}`}>
                  {currentPlayer.role?.toUpperCase()}
                </span>

                <h1 className="text-5xl font-extrabold tracking-tight mb-2">{currentPlayer.name}</h1>
                <p className="text-gray-400 text-lg">Base Price: <span className="text-yellow-300 font-bold">{currentPlayer.basePrice} pts</span></p>

                {status === 'sold' && (
                  <div className="mt-4 bg-green-800/60 rounded-2xl px-6 py-3">
                    <p className="text-green-300 text-sm font-semibold">SOLD TO</p>
                    <p className="text-3xl font-extrabold text-white">{leadingTeam?.name}</p>
                    <p className="text-green-400 text-2xl font-bold">{currentPrice} pts</p>
                  </div>
                )}

                {status === 'unsold' && (
                  <div className="mt-4 bg-gray-700/60 rounded-2xl px-6 py-3">
                    <p className="text-gray-400 text-xl font-bold">UNSOLD</p>
                  </div>
                )}
              </div>

              {/* Current bid */}
              {status === 'running' && (
                <div className={`text-center transition-all duration-200 ${bidFlash ? 'scale-110' : ''}`}>
                  <p className="text-gray-400 text-sm uppercase tracking-widest mb-1">Current Bid</p>
                  <p className={`text-7xl font-extrabold tabular-nums ${bidFlash ? 'text-yellow-300' : 'text-white'}`}>
                    {currentPrice}
                    <span className="text-3xl text-gray-400 ml-2">pts</span>
                  </p>
                  {leadingTeam ? (
                    <p className="text-blue-300 text-xl font-semibold mt-1">🔥 {leadingTeam.name} is leading</p>
                  ) : (
                    <p className="text-gray-500 text-lg mt-1">No bids yet</p>
                  )}
                </div>
              )}

              {/* Timer bar */}
              {status === 'running' && config.timerEnabled && timerLeft !== null && (
                <div className="w-full max-w-md">
                  <div className="flex justify-between text-sm text-gray-400 mb-1">
                    <span>Timer</span>
                    <span className={timerLeft <= 5 ? 'text-red-400 font-bold animate-pulse' : ''}>{timerLeft}s</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-3">
                    <div className={`h-3 rounded-full transition-all duration-1000 ${timerColor}`}
                      style={{ width: `${timerPct}%` }} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Right: teams scoreboard ── */}
        <div className="w-72 bg-gray-900 border-l border-gray-800 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Teams</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {teams.map(team => {
              const isLeading = team.id === leadingTeamId
              return (
                <div key={team.id}
                  className={`rounded-xl p-3 border transition-all ${isLeading
                    ? 'bg-blue-900/50 border-blue-600'
                    : 'bg-gray-800 border-gray-700'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-sm truncate">{team.name}</span>
                    {isLeading && <span className="text-xs text-blue-300 font-bold shrink-0 ml-1">🔥 Leading</span>}
                  </div>
                  {/* Budget bar (% only — no exact numbers) */}
                  <div className="w-full bg-gray-700 rounded-full h-1.5 mb-1.5">
                    <div className={`h-1.5 rounded-full transition-all ${isLeading ? 'bg-blue-400' : 'bg-emerald-500'}`}
                      style={{ width: `${team.budgetPct ?? 100}%` }} />
                  </div>
                  <p className="text-xs text-gray-500">{team.playerCount ?? team.players?.length ?? 0} player{(team.playerCount ?? team.players?.length ?? 0) !== 1 ? 's' : ''} • {team.budgetPct ?? 100}% budget left</p>
                </div>
              )
            })}
          </div>

          {/* Recent sold */}
          {recentSold.length > 0 && (
            <>
              <div className="px-4 py-2 border-t border-gray-800">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recently Sold</h2>
              </div>
              <div className="px-3 pb-3 space-y-1">
                {recentSold.map((p, i) => {
                  const buyer = teams.find(t => t.id === p.soldTo)
                  return (
                    <div key={i} className="flex justify-between items-center text-xs bg-gray-800 rounded-lg px-2 py-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
                        <div className="min-w-0">
                          <span className="text-gray-200 font-medium">{p.name}</span>
                          <span className={`ml-1 ${ROLE_TEXT[p.role] || 'text-gray-400'}`}>({p.role})</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <span className="text-yellow-400 font-mono">{p.soldPrice}pts</span>
                        {buyer && <p className="text-gray-500">{buyer.name}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
