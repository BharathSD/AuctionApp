import { useEffect, useRef, useCallback, useReducer } from 'react'
import { io } from 'socket.io-client'

function reducer(state, action) {
  switch (action.type) {
    case 'STATE_UPDATE':
      return { ...state, ...action.payload, connected: true }
    case 'BID_ACCEPTED':
      return {
        ...state,
        currentPrice: action.payload.price,
        leadingTeamId: action.payload.teamId,
        timerLeft: action.payload.timerLeft ?? state.timerLeft,
      }
    case 'TIMER_TICK':
      return { ...state, timerLeft: action.payload.timerLeft }
    case 'SET_CONNECTED':
      return { ...state, connected: action.payload }
    case 'BID_REJECTED':
      return { ...state, lastError: action.payload.reason }
    case 'CLEAR_ERROR':
      return { ...state, lastError: null }
    case 'SESSION_ERROR':
      return { ...state, sessionError: action.payload.reason }
    case 'CAPTAIN_CONNECTED':
      return { ...state, connectedTeamIds: action.payload.connectedTeamIds }
    case 'CAPTAIN_DISCONNECTED':
      return { ...state, connectedTeamIds: state.connectedTeamIds.filter(id => id !== action.payload.teamId) }
    default:
      return state
  }
}

const INITIAL = {
  connected: false,
  status: 'idle',
  currentPrice: null,
  leadingTeamId: null,
  timerLeft: null,
  teams: [],
  players: [],
  queue: [],
  currentIdx: -1,
  bids: [],
  config: {},
  connectedTeamIds: [],
  lastError: null,
  sessionError: null,
}

export function useOnlineAuction({ roomCode, role, teamId }) {
  const socketRef = useRef(null)
  const [state, dispatch] = useReducer(reducer, INITIAL)

  useEffect(() => {
    const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] })
    socketRef.current = socket

    socket.on('connect', () => {
      dispatch({ type: 'SET_CONNECTED', payload: true })
      if (role === 'admin') socket.emit('admin:join', { roomCode })
      else socket.emit('captain:join', { roomCode, teamId })
    })

    socket.on('disconnect', () => dispatch({ type: 'SET_CONNECTED', payload: false }))

    socket.on('auction:stateUpdate', (data) => dispatch({ type: 'STATE_UPDATE', payload: data }))
    socket.on('auction:playerStart', (data) => dispatch({ type: 'STATE_UPDATE', payload: data }))
    socket.on('auction:secondRound', (data) => dispatch({ type: 'STATE_UPDATE', payload: data }))
    socket.on('auction:sold', (data) => dispatch({ type: 'STATE_UPDATE', payload: data }))
    socket.on('auction:unsold', (data) => dispatch({ type: 'STATE_UPDATE', payload: data }))
    socket.on('auction:finished', (data) => dispatch({ type: 'STATE_UPDATE', payload: data }))
    socket.on('bid:accepted', (data) => dispatch({ type: 'BID_ACCEPTED', payload: data }))
    socket.on('bid:rejected', (data) => dispatch({ type: 'BID_REJECTED', payload: data }))
    socket.on('timer:tick', (data) => dispatch({ type: 'TIMER_TICK', payload: data }))
    socket.on('session:kicked', (data) => dispatch({ type: 'SESSION_ERROR', payload: data }))
    socket.on('session:rejected', (data) => dispatch({ type: 'SESSION_ERROR', payload: data }))
    socket.on('captain:connected', (data) => dispatch({ type: 'CAPTAIN_CONNECTED', payload: data }))
    socket.on('captain:disconnected', (data) => dispatch({ type: 'CAPTAIN_DISCONNECTED', payload: data }))

    return () => socket.disconnect()
  }, [roomCode, role, teamId])

  const adminNextPlayer = useCallback(() => socketRef.current?.emit('admin:nextPlayer'), [])
  const adminUndoBid = useCallback(() => socketRef.current?.emit('admin:undoBid'), [])
  const adminFinish = useCallback(() => socketRef.current?.emit('admin:finish'), [])
  const adminSold = useCallback(() => socketRef.current?.emit('admin:sold'), [])
  const adminUnsold = useCallback(() => socketRef.current?.emit('admin:unsold'), [])
  const adminRequeueUnsold = useCallback(() => socketRef.current?.emit('admin:requeueUnsold'), [])
  const adminKickTeam = useCallback((teamId) => socketRef.current?.emit('admin:kickTeam', { teamId }), [])
  const adminPause = useCallback(() => socketRef.current?.emit('admin:pause'), [])
  const adminResume = useCallback(() => socketRef.current?.emit('admin:resume'), [])
  const captainBid = useCallback(() => socketRef.current?.emit('captain:bid'), [])
  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), [])

  const currentPlayer = state.queue[state.currentIdx] !== undefined
    ? state.players[state.queue[state.currentIdx]]
    : null
  const leadingTeam = state.teams.find(t => t.id === state.leadingTeamId) || null

  return {
    state,
    currentPlayer,
    leadingTeam,
    adminNextPlayer,
    adminUndoBid,
    adminFinish,
    adminSold,
    adminUnsold,
    adminRequeueUnsold,
    adminKickTeam,
    adminPause,
    adminResume,
    captainBid,
    clearError,
  }
}
