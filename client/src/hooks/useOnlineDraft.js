import { useEffect, useRef, useCallback, useReducer } from 'react'
import { io } from 'socket.io-client'
import { loadAuctionState } from './useAuctionStorage'

// Round Robin Selection — online (multi-device) engine. Mirrors
// useOnlineAuction.js's socket wiring and state shape, swapping
// bid/sell events for pick/turn events (server is authoritative; this
// hook only merges server-pushed state, same as the bidding hook).

function reducer(state, action) {
  switch (action.type) {
    case 'STATE_UPDATE':
      return { ...state, ...action.payload, connected: true, sessionError: null }
    case 'TIMER_TICK':
      return { ...state, timerLeft: action.payload.timerLeft }
    case 'SET_CONNECTED':
      return { ...state, connected: action.payload }
    case 'PICK_REJECTED':
      return { ...state, lastError: action.payload.reason }
    case 'CLEAR_ERROR':
      return { ...state, lastError: null }
    case 'SESSION_ERROR':
      return { ...state, sessionError: action.payload.reason }
    case 'CLEAR_SESSION_ERROR':
      return { ...state, sessionError: null }
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
  teams: [],
  players: [],
  categories: [],
  categoryGroups: [],
  currentCategoryIdx: 0,
  currentCategory: null,
  pickOrder: [],
  currentTurnIdx: 0,
  currentTurnTeamId: null,
  picks: [],
  canUndoPick: false,
  timerLeft: null,
  config: {},
  connectedTeamIds: [],
  lastError: null,
  sessionError: null,
}

export function useOnlineDraft({ roomCode, role, teamId, adminToken }) {
  const socketRef = useRef(null)
  const [state, dispatch] = useReducer(reducer, INITIAL)

  useEffect(() => {
    if (!roomCode) return undefined

    const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] })
    socketRef.current = socket

    socket.on('connect', () => {
      dispatch({ type: 'SET_CONNECTED', payload: true })
      if (role === 'admin') {
        const saved = loadAuctionState?.() || {}
        const token = adminToken || saved.adminToken || ''
        socket.emit('admin:join', { roomCode, adminToken: token })
      } else {
        const captainToken = sessionStorage.getItem('captain_token') || ''
        socket.emit('captain:join', { roomCode, teamId, captainToken })
      }
    })

    socket.on('disconnect', () => dispatch({ type: 'SET_CONNECTED', payload: false }))
    socket.on('error', (data) => {
      const reason = data?.message || 'Connection error'
      dispatch({ type: 'SESSION_ERROR', payload: { reason } })
    })

    socket.on('auction:stateUpdate', (data) => dispatch({ type: 'STATE_UPDATE', payload: data }))
    socket.on('draft:orderSet', (data) => dispatch({ type: 'STATE_UPDATE', payload: data }))
    socket.on('draft:started', (data) => dispatch({ type: 'STATE_UPDATE', payload: data }))
    socket.on('draft:picked', (data) => dispatch({ type: 'STATE_UPDATE', payload: data }))
    socket.on('draft:stateUpdate', (data) => dispatch({ type: 'STATE_UPDATE', payload: data }))
    socket.on('draft:finished', (data) => dispatch({ type: 'STATE_UPDATE', payload: data }))
    socket.on('pick:rejected', (data) => dispatch({ type: 'PICK_REJECTED', payload: data }))
    socket.on('timer:tick', (data) => dispatch({ type: 'TIMER_TICK', payload: data }))
    socket.on('session:kicked', (data) => dispatch({ type: 'SESSION_ERROR', payload: data }))
    socket.on('session:rejected', (data) => dispatch({ type: 'SESSION_ERROR', payload: data }))
    socket.on('captain:connected', (data) => dispatch({ type: 'CAPTAIN_CONNECTED', payload: data }))
    socket.on('captain:disconnected', (data) => dispatch({ type: 'CAPTAIN_DISCONNECTED', payload: data }))

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [roomCode, role, teamId, adminToken])

  const adminRandomizePickOrder = useCallback(() => socketRef.current?.emit('admin:randomizePickOrder'), [])
  const adminStartDraft = useCallback(() => socketRef.current?.emit('admin:startDraft'), [])
  const adminPick = useCallback((playerId) => socketRef.current?.emit('admin:pick', { playerId }), [])
  const adminUndoPick = useCallback(() => socketRef.current?.emit('admin:undoPick'), [])
  const adminFinish = useCallback(() => socketRef.current?.emit('admin:finish'), [])
  const adminKickTeam = useCallback((teamId) => socketRef.current?.emit('admin:kickTeam', { teamId }), [])
  const adminPause = useCallback(() => socketRef.current?.emit('admin:pause'), [])
  const adminResume = useCallback(() => socketRef.current?.emit('admin:resume'), [])
  const captainPick = useCallback((playerId) => socketRef.current?.emit('captain:pick', { playerId }), [])
  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), [])
  const clearSessionError = useCallback(() => dispatch({ type: 'CLEAR_SESSION_ERROR' }), [])

  const currentTurnTeam = state.teams.find(t => t.id === state.currentTurnTeamId) || null

  return {
    state,
    currentTurnTeam,
    adminRandomizePickOrder,
    adminStartDraft,
    adminPick,
    adminUndoPick,
    adminFinish,
    adminKickTeam,
    adminPause,
    adminResume,
    captainPick,
    clearError,
    clearSessionError,
  }
}
