import { useReducer, useEffect, useRef, useCallback } from 'react'
import { loadAuctionState, updateAuctionState } from './useAuctionStorage'

// Round Robin Selection — offline (single-screen) engine. No budget/bidding:
// teams take turns (rotating every full round) picking any available
// player from the current category; once a category is exhausted the
// draft advances to the next (randomized) category. Mirrors the shape of
// useOfflineAuction.js so the surrounding storage/persistence code can stay
// engine-agnostic.

// ─── Action types ─────────────────────────────────────────────
const A = {
  LOAD: 'LOAD',
  RANDOMIZE_ORDER: 'RANDOMIZE_ORDER',
  START: 'START',
  PICK: 'PICK',
  UNDO_PICK: 'UNDO_PICK',
  FORFEIT_TURN: 'FORFEIT_TURN',
  TICK: 'TICK',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  FINISH: 'FINISH',
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Admin-arranged category order (config.categoryOrder), merged with whatever
// pending-player roles actually exist — any role missing from the configured
// order (e.g. players added after the order was set) is appended at the end
// rather than silently dropped.
function resolveCategoryOrder(configOrder, pendingPlayers) {
  const present = [...new Set(pendingPlayers.map(p => p.role))]
  const order = Array.isArray(configOrder) ? configOrder : []
  return [...order.filter(c => present.includes(c)), ...present.filter(c => !order.includes(c))]
}

function categoryHasPending(players, categories, categoryIdx) {
  const category = categories[categoryIdx]
  return players.some(p => p.status === 'pending' && p.role === category)
}

function teamRosterFull(teams, teamId, maxPlayers) {
  if (!maxPlayers) return false
  const team = teams.find(t => t.id === teamId)
  return team ? team.players.length >= maxPlayers : false
}

function rotateTurn(pickOrder, currentTurnIdx) {
  let nextIdx = currentTurnIdx + 1
  let nextOrder = pickOrder
  if (nextIdx >= pickOrder.length) {
    nextOrder = [...pickOrder.slice(1), pickOrder[0]] // first mover moves to last
    nextIdx = 0
  }
  return { pickOrder: nextOrder, currentTurnIdx: nextIdx }
}

// Skips forward through exhausted categories and capped-out teams until a
// valid (category, team) turn is found, or the draft is finished.
function advanceDraftState({ players, teams, categories, currentCategoryIdx, pickOrder, currentTurnIdx, maxPlayers }) {
  let catIdx = currentCategoryIdx
  let order = pickOrder
  let turnIdx = currentTurnIdx
  const guardLimit = (order.length || 1) * (categories.length + 1) + order.length + 5
  for (let i = 0; i < guardLimit; i++) {
    if (order.length === 0 || catIdx >= categories.length) {
      return { currentCategoryIdx: catIdx, pickOrder: order, currentTurnIdx: turnIdx, status: 'finished' }
    }
    if (!categoryHasPending(players, categories, catIdx)) {
      catIdx += 1
      continue
    }
    if (teams.every(t => teamRosterFull(teams, t.id, maxPlayers))) {
      return { currentCategoryIdx: catIdx, pickOrder: order, currentTurnIdx: turnIdx, status: 'finished' }
    }
    const teamId = order[turnIdx]
    if (teamRosterFull(teams, teamId, maxPlayers)) {
      const rotated = rotateTurn(order, turnIdx)
      order = rotated.pickOrder
      turnIdx = rotated.currentTurnIdx
      continue
    }
    return { currentCategoryIdx: catIdx, pickOrder: order, currentTurnIdx: turnIdx, status: 'running' }
  }
  return { currentCategoryIdx: catIdx, pickOrder: order, currentTurnIdx: turnIdx, status: 'finished' }
}

function buildInitialState(saved) {
  if (saved._runtime) {
    const r = saved._runtime
    return {
      config: saved.config,
      teams: saved.teams,
      players: saved.players,
      categories: r.categories || [],
      currentCategoryIdx: r.currentCategoryIdx || 0,
      pickOrder: r.pickOrder || [],
      currentTurnIdx: r.currentTurnIdx || 0,
      status: r.status || 'idle',
      picks: r.picks || [],
      paused: false,
      timerLeft: saved.config.timerEnabled ? saved.config.timerSeconds : null,
    }
  }
  const categories = resolveCategoryOrder(
    saved.config.categoryOrder,
    saved.players.filter(p => p.status === 'pending')
  )
  return {
    config: saved.config,
    teams: saved.teams,
    players: saved.players,
    categories,
    currentCategoryIdx: 0,
    pickOrder: [], // set only via RANDOMIZE_ORDER — an explicit admin action
    currentTurnIdx: 0,
    status: 'idle',
    picks: [],
    paused: false,
    timerLeft: saved.config.timerEnabled ? saved.config.timerSeconds : null,
  }
}

function reducer(state, action) {
  switch (action.type) {
    case A.LOAD:
      return buildInitialState(action.payload)

    case A.RANDOMIZE_ORDER: {
      if (state.status !== 'idle') return state
      return { ...state, pickOrder: shuffle(state.teams.map(t => t.id)), currentTurnIdx: 0 }
    }

    case A.START: {
      if (state.status !== 'idle' || state.pickOrder.length === 0) return state
      const maxPlayers = Number(state.config.maxPlayersPerTeam) || 0
      const advanced = advanceDraftState({
        players: state.players,
        teams: state.teams,
        categories: state.categories,
        currentCategoryIdx: state.currentCategoryIdx,
        pickOrder: state.pickOrder,
        currentTurnIdx: state.currentTurnIdx,
        maxPlayers,
      })
      return {
        ...state,
        ...advanced,
        timerLeft: state.config.timerEnabled ? state.config.timerSeconds : null,
        paused: false,
      }
    }

    case A.PICK: {
      const { teamId, playerId } = action
      if (state.status !== 'running' || state.paused) return state
      if (state.pickOrder[state.currentTurnIdx] !== teamId) return state
      const playerIdx = state.players.findIndex(p => p.id === playerId)
      if (playerIdx < 0) return state
      const player = state.players[playerIdx]
      if (player.status !== 'pending') return state
      if (player.role !== state.categories[state.currentCategoryIdx]) return state
      const maxPlayers = Number(state.config.maxPlayersPerTeam) || 0
      const team = state.teams.find(t => t.id === teamId)
      if (!team) return state
      if (maxPlayers > 0 && team.players.length >= maxPlayers) return state

      const pickSnapshot = {
        playerId: player.id,
        playerIdx,
        playerBefore: { ...player },
        teamId,
        pickOrder: state.pickOrder,
        currentTurnIdx: state.currentTurnIdx,
        currentCategoryIdx: state.currentCategoryIdx,
        ts: Date.now(),
      }

      const soldAt = Date.now()
      const teams = state.teams.map(t =>
        t.id === teamId
          ? { ...t, players: [...t.players, { ...player, status: 'sold', soldTo: teamId, soldAt }] }
          : t
      )
      const players = state.players.map((p, i) =>
        i === playerIdx ? { ...p, status: 'sold', soldTo: teamId, soldAt } : p
      )

      const rotated = rotateTurn(state.pickOrder, state.currentTurnIdx)
      const advanced = advanceDraftState({
        players,
        teams,
        categories: state.categories,
        currentCategoryIdx: state.currentCategoryIdx,
        pickOrder: rotated.pickOrder,
        currentTurnIdx: rotated.currentTurnIdx,
        maxPlayers,
      })

      return {
        ...state,
        teams,
        players,
        ...advanced,
        timerLeft: state.config.timerEnabled ? state.config.timerSeconds : null,
        picks: [pickSnapshot, ...state.picks],
      }
    }

    case A.UNDO_PICK: {
      if (!state.picks.length) return state
      const [last, ...remaining] = state.picks
      const teams = state.teams.map(t => {
        if (t.id !== last.teamId) return t
        const roster = [...t.players]
        const lastIdx = roster.length - 1
        if (roster[lastIdx]?.id === last.playerId) {
          roster.pop()
        } else {
          const idx = roster.findLastIndex(p => p.id === last.playerId)
          if (idx >= 0) roster.splice(idx, 1)
        }
        return { ...t, players: roster }
      })
      const players = state.players.map((p, i) =>
        i === last.playerIdx ? { ...last.playerBefore, status: 'pending', soldTo: null, soldAt: null } : p
      )
      return {
        ...state,
        teams,
        players,
        pickOrder: last.pickOrder,
        currentTurnIdx: last.currentTurnIdx,
        currentCategoryIdx: last.currentCategoryIdx,
        status: 'running',
        paused: false,
        timerLeft: state.config.timerEnabled ? state.config.timerSeconds : state.timerLeft,
        picks: remaining,
      }
    }

    case A.FORFEIT_TURN: {
      // Turn timer expired with no pick made — the on-turn team forfeits
      // this turn (no player assigned, nothing added to the undo stack).
      if (state.status !== 'running') return state
      const maxPlayers = Number(state.config.maxPlayersPerTeam) || 0
      const rotated = rotateTurn(state.pickOrder, state.currentTurnIdx)
      const advanced = advanceDraftState({
        players: state.players,
        teams: state.teams,
        categories: state.categories,
        currentCategoryIdx: state.currentCategoryIdx,
        pickOrder: rotated.pickOrder,
        currentTurnIdx: rotated.currentTurnIdx,
        maxPlayers,
      })
      return {
        ...state,
        ...advanced,
        timerLeft: state.config.timerEnabled ? state.config.timerSeconds : null,
      }
    }

    case A.TICK:
      if (!state.config.timerEnabled || state.paused || state.status !== 'running') return state
      if (state.timerLeft <= 1) return { ...state, timerLeft: 0 }
      return { ...state, timerLeft: state.timerLeft - 1 }

    case A.PAUSE:
      return { ...state, paused: true }

    case A.RESUME:
      return { ...state, paused: false }

    case A.FINISH: {
      const players = state.players.map(p => p.status === 'sold' ? p : { ...p, status: 'unsold' })
      return { ...state, players, status: 'finished' }
    }

    default:
      return state
  }
}

// Exported for unit testing only
export { reducer as _reducer, buildInitialState as _buildInitialState }

// ─── Hook ─────────────────────────────────────────────────────
export function useOfflineDraft() {
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
        categories: state.categories,
        currentCategoryIdx: state.currentCategoryIdx,
        pickOrder: state.pickOrder,
        currentTurnIdx: state.currentTurnIdx,
        status: state.status,
        picks: state.picks,
      },
    }))
  }, [state.teams, state.players, state.categories, state.currentCategoryIdx, state.pickOrder, state.currentTurnIdx, state.status, state.picks])

  // Turn timer tick
  useEffect(() => {
    if (state.status !== 'running' || !state.config.timerEnabled || state.paused) {
      clearInterval(timerRef.current)
      return
    }
    timerRef.current = setInterval(() => dispatch({ type: A.TICK }), 1000)
    return () => clearInterval(timerRef.current)
  }, [state.status, state.config.timerEnabled, state.paused])

  // Auto-forfeit when the turn timer hits 0
  useEffect(() => {
    if (state.timerLeft === 0 && state.status === 'running') {
      dispatch({ type: A.FORFEIT_TURN })
    }
  }, [state.timerLeft, state.status])

  const randomizePickOrder = useCallback(() => dispatch({ type: A.RANDOMIZE_ORDER }), [])
  const startDraft = useCallback(() => dispatch({ type: A.START }), [])
  const pickPlayer = useCallback((teamId, playerId) => dispatch({ type: A.PICK, teamId, playerId }), [])
  const undoPick = useCallback(() => dispatch({ type: A.UNDO_PICK }), [])
  const pause = useCallback(() => dispatch({ type: A.PAUSE }), [])
  const resume = useCallback(() => dispatch({ type: A.RESUME }), [])
  const finishDraft = useCallback(() => dispatch({ type: A.FINISH }), [])

  const currentCategory = state.categories[state.currentCategoryIdx] ?? null
  const currentTurnTeamId = state.pickOrder[state.currentTurnIdx] ?? null
  const currentTurnTeam = state.teams.find(t => t.id === currentTurnTeamId) || null

  return {
    state,
    currentCategory,
    currentTurnTeamId,
    currentTurnTeam,
    randomizePickOrder,
    startDraft,
    pickPlayer,
    undoPick,
    pause,
    resume,
    finishDraft,
  }
}
