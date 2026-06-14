import { useReducer, useEffect, useRef, useCallback } from 'react'
import { loadAuctionState, updateAuctionState } from './useAuctionStorage'

// ─── Action types ─────────────────────────────────────────────
const A = {
  LOAD: 'LOAD',
  BID: 'BID',
  UNDO_BID: 'UNDO_BID',
  SOLD: 'SOLD',
  UNSOLD: 'UNSOLD',
  NEXT_PLAYER: 'NEXT_PLAYER',
  TICK: 'TICK',
  RESET_TIMER: 'RESET_TIMER',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  REQUEUE_UNSOLD: 'REQUEUE_UNSOLD',
  FINISH: 'FINISH',
}

function buildInitialState(saved) {
  // If a live runtime state was previously persisted, restore it fully
  if (saved._runtime) {
    const r = saved._runtime
    return {
      config: saved.config,
      teams: saved.teams,
      players: saved.players,
      queue: r.queue,
      currentIdx: r.currentIdx,
      currentPrice: r.currentPrice,
      leadingTeamId: r.leadingTeamId,
      bids: r.bids || [],
      status: r.status,
      timerLeft: saved.config.timerEnabled ? saved.config.timerSeconds : null,
      paused: false,
      secondRound: r.secondRound || false,
    }
  }
  return {
    config: saved.config,
    teams: saved.teams,
    // queue: indices into players array (unsold/pending)
    queue: saved.players.map((_, i) => i),
    players: saved.players,
    currentIdx: 0,       // index into queue
    currentPrice: null,
    leadingTeamId: null,
    bids: [],            // log: [{teamId, price, ts}]
    status: 'idle',      // idle | running | sold | unsold | finished
    timerLeft: saved.config.timerEnabled ? saved.config.timerSeconds : null,
    paused: false,
    secondRound: false,  // true when re-auctioning unsold players
  }
}

function reducer(state, action) {
  switch (action.type) {
    case A.LOAD:
      return buildInitialState(action.payload)

    case A.NEXT_PLAYER: {
      const nextIdx = state.currentIdx + (action.advance ? 1 : 0)
      if (nextIdx >= state.queue.length) {
        // Queue exhausted — auto-requeue unsold players if first round
        if (!state.secondRound) {
          const unsoldIdxs = state.players.reduce((acc, p, i) =>
            p.status === 'unsold' ? [...acc, i] : acc, [])
          if (unsoldIdxs.length > 0) {
            // Reset those players to pending and start second round
            const players = state.players.map((p, i) =>
              unsoldIdxs.includes(i) ? { ...p, status: 'pending' } : p)
            const firstOfUnsold = unsoldIdxs[0]
            return {
              ...state,
              players,
              queue: unsoldIdxs,
              currentIdx: 0,
              currentPrice: players[firstOfUnsold].basePrice,
              leadingTeamId: null,
              bids: [],
              status: 'running',
              secondRound: true,
              timerLeft: state.config.timerEnabled ? state.config.timerSeconds : null,
              paused: false,
            }
          }
        }
        return { ...state, status: 'finished' }
      }
      const playerIdx = state.queue[nextIdx]
      const basePrice = state.players[playerIdx].basePrice
      return {
        ...state,
        currentIdx: nextIdx,
        currentPrice: basePrice,
        leadingTeamId: null,
        bids: [],
        status: 'running',
        timerLeft: state.config.timerEnabled ? state.config.timerSeconds : null,
        paused: false,
      }
    }

    case A.BID: {
      const { teamId } = action
      const team = state.teams.find(t => t.id === teamId)
      if (!team) return state
      if (state.leadingTeamId === teamId) return state // already leading
      const newPrice = state.bids.length === 0
        ? state.currentPrice
        : state.currentPrice + state.config.bidIncrement
      if (team.budget < newPrice) return state // not enough budget
      if (state.status !== 'running' || state.paused) return state
      return {
        ...state,
        currentPrice: newPrice,
        leadingTeamId: teamId,
        timerLeft: state.config.timerEnabled ? state.config.timerSeconds : null,
        bids: [{ teamId, price: newPrice, ts: Date.now() }, ...state.bids],
      }
    }

    case A.UNDO_BID: {
      if (!state.bids.length || state.status !== 'running') return state
      const [, ...remainingBids] = state.bids
      const playerIdx = state.queue[state.currentIdx]
      const basePrice = state.players[playerIdx].basePrice
      return {
        ...state,
        currentPrice: remainingBids.length > 0 ? remainingBids[0].price : basePrice,
        leadingTeamId: remainingBids.length > 0 ? remainingBids[0].teamId : null,
        bids: remainingBids,
        timerLeft: state.config.timerEnabled ? state.config.timerSeconds : null,
      }
    }

    case A.SOLD: {
      if (!state.leadingTeamId) return state
      const playerIdx = state.queue[state.currentIdx]
      const teams = state.teams.map(t =>
        t.id === state.leadingTeamId
          ? { ...t, budget: t.budget - state.currentPrice, spent: (t.spent || 0) + state.currentPrice, players: [...t.players, { ...state.players[playerIdx], soldPrice: state.currentPrice }] }
          : t
      )
      const players = state.players.map((p, i) =>
        i === playerIdx ? { ...p, status: 'sold', soldTo: state.leadingTeamId, soldPrice: state.currentPrice } : p
      )
      return {
        ...state,
        teams,
        players,
        status: 'sold',
        paused: false,
      }
    }

    case A.UNSOLD: {
      const playerIdx = state.queue[state.currentIdx]
      const players = state.players.map((p, i) =>
        i === playerIdx ? { ...p, status: 'unsold' } : p
      )
      return { ...state, players, status: 'unsold', paused: false }
    }

    case A.TICK:
      if (!state.config.timerEnabled || state.paused || state.status !== 'running') return state
      if (state.timerLeft <= 1) {
        // Auto-resolve: sold if someone bid, else unsold
        if (state.leadingTeamId) {
          // trigger sold via side-effect outside reducer — signal with timerLeft = 0
          return { ...state, timerLeft: 0 }
        }
        return { ...state, timerLeft: 0 }
      }
      return { ...state, timerLeft: state.timerLeft - 1 }

    case A.PAUSE:
      return { ...state, paused: true }

    case A.RESUME:
      return { ...state, paused: false }

    case A.REQUEUE_UNSOLD: {
      const unsoldIdxs = state.players.reduce((acc, p, i) => p.status === 'unsold' ? [...acc, i] : acc, [])
      const remainingQueue = state.queue.slice(state.currentIdx + 1)
      return { ...state, queue: [...remainingQueue, ...unsoldIdxs], currentIdx: -1, status: 'idle' }
    }

    case A.FINISH:
      return { ...state, status: 'finished' }

    default:
      return state
  }
}

// ─── Hook ─────────────────────────────────────────────────────
export function useOfflineAuction() {
  const saved = loadAuctionState()
  const [state, dispatch] = useReducer(reducer, saved, buildInitialState)
  const timerRef = useRef(null)

  // Persist to localStorage on every state change
  useEffect(() => {
    updateAuctionState(current => ({
      ...current,
      teams: state.teams,
      players: state.players,
      _runtime: {
        queue: state.queue,
        currentIdx: state.currentIdx,
        currentPrice: state.currentPrice,
        leadingTeamId: state.leadingTeamId,
        bids: state.bids,
        status: state.status,
        secondRound: state.secondRound,
      },
    }))
  }, [state.teams, state.players, state.queue, state.currentIdx, state.currentPrice, state.leadingTeamId, state.bids, state.status, state.secondRound])

  // Timer tick
  useEffect(() => {
    if (state.status !== 'running' || !state.config.timerEnabled || state.paused) {
      clearInterval(timerRef.current)
      return
    }
    timerRef.current = setInterval(() => dispatch({ type: A.TICK }), 1000)
    return () => clearInterval(timerRef.current)
  }, [state.status, state.config.timerEnabled, state.paused])

  // Auto-resolve when timer hits 0
  useEffect(() => {
    if (state.timerLeft === 0 && state.status === 'running') {
      if (state.leadingTeamId) dispatch({ type: A.SOLD })
      else dispatch({ type: A.UNSOLD })
    }
  }, [state.timerLeft, state.status, state.leadingTeamId])

  const startAuction = useCallback(() => dispatch({ type: A.NEXT_PLAYER, advance: false }), [])
  const recordBid = useCallback((teamId) => dispatch({ type: A.BID, teamId }), [])
  const undoBid = useCallback(() => dispatch({ type: A.UNDO_BID }), [])
  const markSold = useCallback(() => dispatch({ type: A.SOLD }), [])
  const markUnsold = useCallback(() => dispatch({ type: A.UNSOLD }), [])
  const nextPlayer = useCallback(() => dispatch({ type: A.NEXT_PLAYER, advance: true }), [])
  const pause = useCallback(() => dispatch({ type: A.PAUSE }), [])
  const resume = useCallback(() => dispatch({ type: A.RESUME }), [])
  const requeueUnsold = useCallback(() => dispatch({ type: A.REQUEUE_UNSOLD }), [])
  const finishAuction = useCallback(() => dispatch({ type: A.FINISH }), [])

  const currentPlayer = state.queue[state.currentIdx] !== undefined
    ? state.players[state.queue[state.currentIdx]]
    : null
  const leadingTeam = state.teams.find(t => t.id === state.leadingTeamId) || null

  return {
    state,
    currentPlayer,
    leadingTeam,
    startAuction,
    recordBid,
    undoBid,
    markSold,
    markUnsold,
    nextPlayer,
    pause,
    resume,
    requeueUnsold,
    finishAuction,
  }
}
