import { describe, it, expect } from 'vitest'
import { _reducer as reducer, _buildInitialState as buildInitialState } from '../hooks/useOfflineDraft'

// ─── Helpers ──────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    maxPlayersPerTeam: 0,
    timerEnabled: false,
    timerSeconds: 30,
    ...overrides,
  }
}

function makeTeams(count = 2) {
  return Array.from({ length: count }, (_, i) => ({
    id: `team${i + 1}`,
    name: `Team ${i + 1}`,
    players: [],
  }))
}

function makePlayers(spec) {
  // spec: [{role, count}]
  const players = []
  let n = 0
  spec.forEach(({ role, count }) => {
    for (let i = 0; i < count; i++) {
      n += 1
      players.push({ id: `p${n}`, name: `Player ${n}`, role, status: 'pending' })
    }
  })
  return players
}

/**
 * Build a running draft state with a fixed (non-shuffled) category/pick
 * order. `categoryGroups` defaults to one singleton group per `categories`
 * label (i.e. no merging) when not given explicitly. `categorySkips`
 * defaults to marking the *current* team as already resolved with zero
 * skips owed — matching what a real `advanceDraftState` walk would have
 * already computed by the time a turn is legitimately on offer — so
 * pre-existing tests (written before retention skips existed) keep getting
 * an unrestricted turn unless they explicitly opt into a different value.
 */
function runningState({ config, teams, players, categories, categoryGroups, categorySkips, pickOrder, currentCategoryIdx = 0, currentTurnIdx = 0 }) {
  return {
    config,
    teams,
    players,
    categories,
    categoryGroups: categoryGroups || categories.map(c => ({ roles: [c] })),
    categorySkips: categorySkips !== undefined ? categorySkips : { [pickOrder[currentTurnIdx]]: 0 },
    currentCategoryIdx,
    pickOrder,
    currentTurnIdx,
    status: 'running',
    picks: [],
    events: [],
    paused: false,
    timerLeft: config.timerEnabled ? config.timerSeconds : null,
  }
}

// ─── buildInitialState ────────────────────────────────────────

describe('buildInitialState', () => {
  it('derives categories from distinct pending player roles', () => {
    const players = makePlayers([{ role: 'Batsman', count: 2 }, { role: 'Bowler', count: 1 }])
    const state = buildInitialState({ config: makeConfig(), teams: makeTeams(), players })
    expect(state.categories.sort()).toEqual(['Batsman', 'Bowler'])
    expect(state.status).toBe('idle')
  })

  it('excludes pre-allocated (non-pending) players from categories', () => {
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Bowler', count: 1 }])
    players[1].status = 'sold'
    const state = buildInitialState({ config: makeConfig(), teams: makeTeams(), players })
    expect(state.categories).toEqual(['Batsman'])
  })

  it('starts with an empty pick order — only RANDOMIZE_ORDER populates it', () => {
    const teams = makeTeams(4)
    const players = makePlayers([{ role: 'Batsman', count: 1 }])
    const state = buildInitialState({ config: makeConfig(), teams, players })
    expect(state.pickOrder).toEqual([])
  })

  it('uses config.categoryGroups verbatim when every category is present', () => {
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Bowler', count: 1 }])
    const state = buildInitialState({
      config: makeConfig({ categoryGroups: [{ roles: ['Bowler'] }, { roles: ['Batsman'] }] }),
      teams: makeTeams(),
      players,
    })
    expect(state.categories).toEqual(['Bowler', 'Batsman'])
    expect(state.categoryGroups).toEqual([{ roles: ['Bowler'] }, { roles: ['Batsman'] }])
  })

  it('appends present categories missing from config.categoryGroups, and drops absent ones', () => {
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Bowler', count: 1 }])
    const state = buildInitialState({
      // "Super Striker" no longer has any players; "Bowler" was never grouped.
      config: makeConfig({ categoryGroups: [{ roles: ['Super Striker'] }, { roles: ['Batsman'] }] }),
      teams: makeTeams(),
      players,
    })
    expect(state.categories).toEqual(['Batsman', 'Bowler'])
  })

  it('joins merged roles into one combined category label', () => {
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Wicket-keeper', count: 1 }, { role: 'Bowler', count: 1 }])
    const state = buildInitialState({
      config: makeConfig({ categoryGroups: [{ roles: ['Batsman', 'Wicket-keeper'] }, { roles: ['Bowler'] }] }),
      teams: makeTeams(),
      players,
    })
    expect(state.categories).toEqual(['Batsman + Wicket-keeper', 'Bowler'])
    expect(state.categoryGroups).toEqual([{ roles: ['Batsman', 'Wicket-keeper'] }, { roles: ['Bowler'] }])
  })

  it('shrinks (rather than drops) a merged group when only some of its roles are still present', () => {
    const players = makePlayers([{ role: 'Batsman', count: 1 }])
    const state = buildInitialState({
      // "Wicket-keeper" no longer has any players.
      config: makeConfig({ categoryGroups: [{ roles: ['Batsman', 'Wicket-keeper'] }] }),
      teams: makeTeams(),
      players,
    })
    expect(state.categoryGroups).toEqual([{ roles: ['Batsman'] }])
  })

  it('restores from a persisted _runtime snapshot', () => {
    const state = buildInitialState({
      config: makeConfig(),
      teams: makeTeams(),
      players: makePlayers([{ role: 'Batsman', count: 1 }]),
      _runtime: {
        categories: ['Batsman'],
        currentCategoryIdx: 0,
        pickOrder: ['team2', 'team1'],
        currentTurnIdx: 1,
        status: 'running',
        picks: [],
      },
    })
    expect(state.pickOrder).toEqual(['team2', 'team1'])
    expect(state.currentTurnIdx).toBe(1)
    expect(state.status).toBe('running')
  })
})

// ─── RANDOMIZE_ORDER / START ───────────────────────────────────

describe('RANDOMIZE_ORDER', () => {
  it('populates the pick order with every team id exactly once', () => {
    const teams = makeTeams(4)
    const players = makePlayers([{ role: 'Batsman', count: 1 }])
    const state = buildInitialState({ config: makeConfig(), teams, players })

    const next = reducer(state, { type: 'RANDOMIZE_ORDER' })

    expect(next.pickOrder.slice().sort()).toEqual(teams.map(t => t.id).sort())
    expect(next.currentTurnIdx).toBe(0)
  })

  it('still allows reshuffling right after starting — start leaves currentTurnIdx at the round boundary (0)', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 1 }])
    let state = buildInitialState({ config: makeConfig(), teams, players })
    state = reducer(state, { type: 'RANDOMIZE_ORDER' })
    state = reducer(state, { type: 'START' })
    expect(state.status).toBe('running')

    const next = reducer(state, { type: 'RANDOMIZE_ORDER' })

    expect(next).not.toBe(state)
    expect(next.currentTurnIdx).toBe(0)
  })

  it('rejects once a pick has moved the draft off the round boundary', () => {
    const teams = makeTeams(3)
    const players = makePlayers([{ role: 'Batsman', count: 3 }])
    let state = buildInitialState({ config: makeConfig(), teams, players })
    state = reducer(state, { type: 'RANDOMIZE_ORDER' })
    state = reducer(state, { type: 'START' })
    const onTurn = state.pickOrder[state.currentTurnIdx]
    const player = state.players.find(p => p.status === 'pending')
    state = reducer(state, { type: 'PICK', teamId: onTurn, playerId: player.id })
    expect(state.currentTurnIdx).not.toBe(0)

    const next = reducer(state, { type: 'RANDOMIZE_ORDER' })

    expect(next).toBe(state)
  })
})

describe('START', () => {
  it('is a no-op until the pick order has been set', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 1 }])
    const state = buildInitialState({ config: makeConfig(), teams, players })
    expect(state.pickOrder).toEqual([])

    const next = reducer(state, { type: 'START' })

    expect(next).toBe(state)
    expect(next.status).toBe('idle')
  })

  it('transitions to running once the pick order is set', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 1 }])
    let state = buildInitialState({ config: makeConfig(), teams, players })
    state = reducer(state, { type: 'RANDOMIZE_ORDER' })

    const next = reducer(state, { type: 'START' })

    expect(next.status).toBe('running')
  })
})

// ─── PICK ─────────────────────────────────────────────────────

describe('PICK', () => {
  it('assigns the player to the on-turn team and advances the turn', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 2 }])
    const state = runningState({ config: makeConfig(), teams, players, categories: ['Batsman'], pickOrder: ['team1', 'team2'] })

    const next = reducer(state, { type: 'PICK', teamId: 'team1', playerId: 'p1' })

    expect(next.players.find(p => p.id === 'p1').status).toBe('sold')
    expect(next.teams.find(t => t.id === 'team1').players.map(p => p.id)).toEqual(['p1'])
    expect(next.currentTurnIdx).toBe(1) // team2's turn now
    expect(next.picks).toHaveLength(1)
  })

  it('rejects a pick when it is not that team\'s turn', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 1 }])
    const state = runningState({ config: makeConfig(), teams, players, categories: ['Batsman'], pickOrder: ['team1', 'team2'] })

    const next = reducer(state, { type: 'PICK', teamId: 'team2', playerId: 'p1' })

    expect(next).toBe(state) // unchanged
  })

  it('rejects a pick from a different category than the current one', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Bowler', count: 1 }])
    const state = runningState({ config: makeConfig(), teams, players, categories: ['Batsman', 'Bowler'], pickOrder: ['team1', 'team2'] })

    const next = reducer(state, { type: 'PICK', teamId: 'team1', playerId: 'p2' }) // p2 is a Bowler

    expect(next).toBe(state)
  })

  it('rotates the pick order (first mover to last) after a full round', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 3 }])
    let state = runningState({ config: makeConfig(), teams, players, categories: ['Batsman'], pickOrder: ['team1', 'team2'] })

    state = reducer(state, { type: 'PICK', teamId: 'team1', playerId: 'p1' })
    state = reducer(state, { type: 'PICK', teamId: 'team2', playerId: 'p2' })

    // Full round complete — team1 (first mover) should now be last.
    expect(state.pickOrder).toEqual(['team2', 'team1'])
    expect(state.currentTurnIdx).toBe(0) // team2 picks next
  })

  it('advances to the next category once the current one is exhausted', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Bowler', count: 2 }])
    let state = runningState({ config: makeConfig(), teams, players, categories: ['Batsman', 'Bowler'], pickOrder: ['team1', 'team2'] })

    // Only one Batsman exists — team1 takes it, which exhausts the category
    // mid-round, so team2 should immediately move on to the Bowler category.
    state = reducer(state, { type: 'PICK', teamId: 'team1', playerId: 'p1' })

    expect(state.currentCategoryIdx).toBe(1)
    expect(state.currentTurnIdx).toBe(1) // still team2's turn, now for Bowler
  })

  it('skips a team whose roster is already at the cap', () => {
    const teams = makeTeams(2)
    // team2 is already at the 2-player cap; team1 has none yet.
    teams[1].players = [
      { id: 'x', name: 'X', role: 'Batsman' },
      { id: 'y', name: 'Y', role: 'Batsman' },
    ]
    const players = makePlayers([{ role: 'Batsman', count: 2 }])
    const state = runningState({
      config: makeConfig({ maxPlayersPerTeam: 2 }),
      teams, players, categories: ['Batsman'], pickOrder: ['team1', 'team2'],
    })

    const next = reducer(state, { type: 'PICK', teamId: 'team1', playerId: 'p1' })

    // team2 is capped, so its turn is skipped — the (rotated) order lands
    // back on team1 for the next pick.
    expect(next.pickOrder).toEqual(['team2', 'team1'])
    expect(next.currentTurnIdx).toBe(1)
    expect(next.status).toBe('running')
  })

  it('finishes the draft once every category is exhausted', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 2 }])
    let state = runningState({ config: makeConfig(), teams, players, categories: ['Batsman'], pickOrder: ['team1', 'team2'] })

    state = reducer(state, { type: 'PICK', teamId: 'team1', playerId: 'p1' })
    state = reducer(state, { type: 'PICK', teamId: 'team2', playerId: 'p2' })

    expect(state.status).toBe('finished')
  })

  it('accepts a pick from either role in a merged category', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Wicket-keeper', count: 1 }])
    const state = runningState({
      config: makeConfig(), teams, players,
      categories: ['Batsman + Wicket-keeper'],
      categoryGroups: [{ roles: ['Batsman', 'Wicket-keeper'] }],
      pickOrder: ['team1', 'team2'],
    })

    // p2 is the Wicket-keeper — not an exact match to the category label,
    // but it belongs to the merged group's role list, so it must be allowed.
    const next = reducer(state, { type: 'PICK', teamId: 'team1', playerId: 'p2' })

    expect(next.players.find(p => p.id === 'p2').status).toBe('sold')
  })

  it('only advances past a merged category once every one of its roles is exhausted', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Wicket-keeper', count: 1 }, { role: 'Bowler', count: 1 }])
    const state = runningState({
      config: makeConfig(), teams, players,
      categories: ['Batsman + Wicket-keeper', 'Bowler'],
      categoryGroups: [{ roles: ['Batsman', 'Wicket-keeper'] }, { roles: ['Bowler'] }],
      pickOrder: ['team1', 'team2'],
    })

    // Only the Batsman is picked — the Wicket-keeper is still pending, so
    // the merged category must not advance yet.
    const next = reducer(state, { type: 'PICK', teamId: 'team1', playerId: 'p1' })

    expect(next.currentCategoryIdx).toBe(0)
  })
})

// ─── UNDO_PICK ────────────────────────────────────────────────

describe('UNDO_PICK', () => {
  it('restores the exact turn/category position and player availability', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Bowler', count: 2 }])
    let state = runningState({ config: makeConfig(), teams, players, categories: ['Batsman', 'Bowler'], pickOrder: ['team1', 'team2'] })

    // This pick exhausts Batsman and advances the category (see test above).
    state = reducer(state, { type: 'PICK', teamId: 'team1', playerId: 'p1' })
    expect(state.currentCategoryIdx).toBe(1)

    const undone = reducer(state, { type: 'UNDO_PICK' })

    expect(undone.currentCategoryIdx).toBe(0)
    expect(undone.currentTurnIdx).toBe(0)
    expect(undone.pickOrder).toEqual(['team1', 'team2'])
    expect(undone.players.find(p => p.id === 'p1').status).toBe('pending')
    expect(undone.teams.find(t => t.id === 'team1').players).toHaveLength(0)
    expect(undone.picks).toHaveLength(0)
  })

  it('is a no-op when there is nothing to undo', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 1 }])
    const state = runningState({ config: makeConfig(), teams, players, categories: ['Batsman'], pickOrder: ['team1', 'team2'] })

    expect(reducer(state, { type: 'UNDO_PICK' })).toBe(state)
  })
})

// ─── FINISH ───────────────────────────────────────────────────

describe('FINISH', () => {
  it('marks every non-picked player unsold and sets status finished', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 2 }])
    const state = runningState({ config: makeConfig(), teams, players, categories: ['Batsman'], pickOrder: ['team1', 'team2'] })

    const next = reducer(state, { type: 'FINISH' })

    expect(next.status).toBe('finished')
    expect(next.players.every(p => p.status === 'unsold')).toBe(true)
  })
})

// ─── Retention skips (proportional to retained players in category) ──

/** Builds a fresh idle state (with a fixed, non-shuffled pick order) via
 * buildInitialState's `_runtime` restore path, so dispatching START runs the
 * real advanceDraftState walk from turn 0 — the only way to legitimately
 * trigger the lazy skip-count initialization. */
function idleStateWithOrder({ config, teams, players, categoryGroups, pickOrder }) {
  return buildInitialState({
    config,
    teams,
    players,
    _runtime: {
      categories: categoryGroups.map(g => g.roles.join(' + ')),
      categoryGroups,
      categorySkips: {},
      currentCategoryIdx: 0,
      pickOrder,
      currentTurnIdx: 0,
      status: 'idle',
      picks: [],
    },
  })
}

/** Picks the first available pending player on behalf of whichever team is
 * currently on turn — used to drive a running draft forward step by step
 * without hand-tracing exact pick-order rotation. */
function playCurrentTurn(state) {
  const teamId = state.pickOrder[state.currentTurnIdx]
  const roles = state.categoryGroups[state.currentCategoryIdx]?.roles || []
  const player = state.players.find(p => p.status === 'pending' && roles.includes(p.role))
  return reducer(state, { type: 'PICK', teamId, playerId: player.id })
}

describe('retention skips', () => {
  it('is a no-op for a team with no retained players in the category', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 2 }])
    const state = idleStateWithOrder({
      config: makeConfig(), teams, players,
      categoryGroups: [{ roles: ['Batsman'] }],
      pickOrder: ['team1', 'team2'],
    })

    const started = reducer(state, { type: 'START' })

    expect(started.pickOrder[started.currentTurnIdx]).toBe('team1')
    expect(started.categorySkips.team1).toBe(0)
  })

  it('skips exactly as many turns as the team has retained players in the category, then picks normally', () => {
    const teams = makeTeams(3)
    teams[0].players = [ // team1 retained 2 Batsman before the draft started
      { id: 'r1', name: 'R1', role: 'Batsman' },
      { id: 'r2', name: 'R2', role: 'Batsman' },
    ]
    const players = makePlayers([{ role: 'Batsman', count: 6 }])
    let state = idleStateWithOrder({
      config: makeConfig(), teams, players,
      categoryGroups: [{ roles: ['Batsman'] }],
      pickOrder: ['team1', 'team2', 'team3'],
    })

    state = reducer(state, { type: 'START' })
    // One skip already consumed by the initial walk finding team1's turn.
    expect(state.categorySkips.team1).toBe(1)
    expect(state.pickOrder[state.currentTurnIdx]).not.toBe('team1')

    let guard = 0
    while (state.categorySkips.team1 > 0 && guard < 10) {
      state = playCurrentTurn(state)
      guard += 1
    }
    expect(state.categorySkips.team1).toBe(0)
    expect(state.picks.some(p => p.teamId === 'team1')).toBe(false) // never picked while skips remained

    while (state.pickOrder[state.currentTurnIdx] !== 'team1' && guard < 20) {
      state = playCurrentTurn(state)
      guard += 1
    }
    expect(state.pickOrder[state.currentTurnIdx]).toBe('team1')

    const pendingBatsman = state.players.find(p => p.status === 'pending' && p.role === 'Batsman')
    const afterPick = reducer(state, { type: 'PICK', teamId: 'team1', playerId: pendingBatsman.id })
    expect(afterPick.teams.find(t => t.id === 'team1').players).toHaveLength(3) // 2 retained + 1 newly picked
  })

  it('is scoped per category — a team skipped in category A gets a fresh count in category B', () => {
    const teams = makeTeams(2)
    teams[0].players = [{ id: 'r1', name: 'R1', role: 'Batsman' }] // retained in Batsman only
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Bowler', count: 2 }])
    let state = idleStateWithOrder({
      config: makeConfig(), teams, players,
      categoryGroups: [{ roles: ['Batsman'] }, { roles: ['Bowler'] }],
      pickOrder: ['team1', 'team2'],
    })

    state = reducer(state, { type: 'START' })
    expect(state.currentCategoryIdx).toBe(0)
    expect(state.pickOrder[state.currentTurnIdx]).not.toBe('team1') // skipped in Batsman

    // team2 takes the only Batsman, which exhausts category 0 and advances
    // to category 1 (Bowler) mid-round.
    state = playCurrentTurn(state)
    expect(state.currentCategoryIdx).toBe(1)

    // Drive forward (at most a couple of steps) until team1's turn comes up
    // in the new category — they have no retained Bowlers, so no skip
    // should be owed here despite having been skipped in category 0.
    let guard = 0
    while (state.pickOrder[state.currentTurnIdx] !== 'team1' && guard < 5) {
      state = playCurrentTurn(state)
      guard += 1
    }
    expect(state.pickOrder[state.currentTurnIdx]).toBe('team1')
    expect(state.categorySkips.team1).toBe(0)
  })

  it('counts a retained player toward the skip total if its role is anywhere in a merged category', () => {
    const teams = makeTeams(2)
    teams[0].players = [{ id: 'r1', name: 'R1', role: 'Wicket-keeper' }]
    const players = makePlayers([{ role: 'Batsman', count: 2 }, { role: 'Wicket-keeper', count: 2 }])
    const state = idleStateWithOrder({
      config: makeConfig(), teams, players,
      categoryGroups: [{ roles: ['Batsman', 'Wicket-keeper'] }],
      pickOrder: ['team1', 'team2'],
    })

    const started = reducer(state, { type: 'START' })

    // team1 retained exactly 1 Wicket-keeper (a role inside this merged
    // category) — their single owed skip is already consumed by the walk
    // that resolved this turn, leaving 0 remaining, and the turn passed to
    // team2 instead of being offered to team1.
    expect(started.categorySkips.team1).toBe(0)
    expect(started.pickOrder[started.currentTurnIdx]).not.toBe('team1')
  })

  it('undo restores categorySkips exactly, even across other teams skipped in between', () => {
    const teams = makeTeams(3)
    teams[0].players = [{ id: 'r1', name: 'R1', role: 'Batsman' }] // team1: 1 skip owed
    const players = makePlayers([{ role: 'Batsman', count: 4 }])
    let state = idleStateWithOrder({
      config: makeConfig(), teams, players,
      categoryGroups: [{ roles: ['Batsman'] }],
      pickOrder: ['team1', 'team2', 'team3'],
    })
    state = reducer(state, { type: 'START' }) // team1 skipped (1 -> 0), team2 on turn
    const beforePick = state

    const afterPick = playCurrentTurn(state) // team2 picks
    expect(afterPick.picks[0].categorySkips).toEqual(beforePick.categorySkips)

    const undone = reducer(afterPick, { type: 'UNDO_PICK' })
    expect(undone.categorySkips).toEqual(beforePick.categorySkips)
    expect(undone.pickOrder).toEqual(beforePick.pickOrder)
    expect(undone.currentTurnIdx).toBe(beforePick.currentTurnIdx)
  })
})

// ─── RANDOMIZE_ORDER — mid-draft (round boundary) ───────────────

describe('RANDOMIZE_ORDER — mid-draft (round boundary)', () => {
  it('rejects reshuffling mid-round (currentTurnIdx !== 0)', () => {
    const teams = makeTeams(3)
    const players = makePlayers([{ role: 'Batsman', count: 4 }])
    let state = idleStateWithOrder({
      config: makeConfig(), teams, players,
      categoryGroups: [{ roles: ['Batsman'] }],
      pickOrder: ['team1', 'team2', 'team3'],
    })
    state = reducer(state, { type: 'START' })
    state = playCurrentTurn(state) // currentTurnIdx now 1 — not a boundary
    expect(state.currentTurnIdx).not.toBe(0)

    const next = reducer(state, { type: 'RANDOMIZE_ORDER' })

    expect(next).toBe(state)
  })

  it('allows reshuffling once running and back at a round boundary', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 4 }])
    let state = idleStateWithOrder({
      config: makeConfig(), teams, players,
      categoryGroups: [{ roles: ['Batsman'] }],
      pickOrder: ['team1', 'team2'],
    })
    state = reducer(state, { type: 'START' })
    state = playCurrentTurn(state)
    state = playCurrentTurn(state) // full round complete — wraps to idx 0
    expect(state.status).toBe('running')
    expect(state.currentTurnIdx).toBe(0)

    const next = reducer(state, { type: 'RANDOMIZE_ORDER' })

    expect(next.pickOrder.slice().sort()).toEqual(['team1', 'team2'])
    expect(next.currentTurnIdx).toBe(0)
  })

  it('logs exactly one shuffle event on a mid-draft reshuffle, none for a pre-draft one', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 4 }])
    let state = buildInitialState({ config: makeConfig(), teams, players })
    state = reducer(state, { type: 'RANDOMIZE_ORDER' }) // idle shuffle — should not log
    expect(state.events).toEqual([])

    state = reducer(state, { type: 'START' })
    state = playCurrentTurn(state)
    state = playCurrentTurn(state) // round wraps

    const next = reducer(state, { type: 'RANDOMIZE_ORDER' })
    expect(next.events).toHaveLength(1)
    expect(next.events[0].type).toBe('shuffle')
  })

  it('does not affect the undo stack', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 4 }])
    let state = idleStateWithOrder({
      config: makeConfig(), teams, players,
      categoryGroups: [{ roles: ['Batsman'] }],
      pickOrder: ['team1', 'team2'],
    })
    state = reducer(state, { type: 'START' })
    state = playCurrentTurn(state)
    state = playCurrentTurn(state)
    const picksBefore = state.picks.length

    const next = reducer(state, { type: 'RANDOMIZE_ORDER' })

    expect(next.picks).toHaveLength(picksBefore)
  })

  it('re-validates the newly-shuffled front team against skip rules', () => {
    // team1 retains a Wicket-keeper — owes 1 skip once the Wicket-keeper
    // category comes up, but hasn't been evaluated against it yet.
    const teams = makeTeams(2)
    teams[0].players = [{ id: 'r1', name: 'R1', role: 'Wicket-keeper' }]
    const players = makePlayers([{ role: 'Batsman', count: 2 }, { role: 'Wicket-keeper', count: 2 }])
    let state = idleStateWithOrder({
      config: makeConfig(), teams, players,
      categoryGroups: [{ roles: ['Batsman'] }, { roles: ['Wicket-keeper'] }],
      pickOrder: ['team1', 'team2'],
    })
    state = reducer(state, { type: 'START' }) // 0 retained Batsman — no skip, team1 leads
    expect(state.pickOrder[state.currentTurnIdx]).toBe('team1')

    state = playCurrentTurn(state) // team1 picks a Batsman
    state = playCurrentTurn(state) // team2 picks the other — Batsman exhausted, Wicket-keeper starts, round wraps

    expect(state.currentCategoryIdx).toBe(1)
    expect(state.currentTurnIdx).toBe(0)
    expect(state.pickOrder[state.currentTurnIdx]).toBe('team2') // team2 evaluated first, owes nothing

    // Whichever way the shuffle lands team1 or team2 up front, team1's
    // still-unconsumed Wicket-keeper skip must keep team2 on the clock.
    const next = reducer(state, { type: 'RANDOMIZE_ORDER' })
    expect(next.pickOrder[next.currentTurnIdx]).toBe('team2')
  })

  it('events survive a `_runtime` restore', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 4 }])
    let state = idleStateWithOrder({
      config: makeConfig(), teams, players,
      categoryGroups: [{ roles: ['Batsman'] }],
      pickOrder: ['team1', 'team2'],
    })
    state = reducer(state, { type: 'START' })
    state = playCurrentTurn(state)
    state = playCurrentTurn(state)
    state = reducer(state, { type: 'RANDOMIZE_ORDER' })
    expect(state.events).toHaveLength(1)

    const restored = buildInitialState({
      config: state.config,
      teams: state.teams,
      players: state.players,
      _runtime: {
        categories: state.categories,
        categoryGroups: state.categoryGroups,
        categorySkips: state.categorySkips,
        currentCategoryIdx: state.currentCategoryIdx,
        pickOrder: state.pickOrder,
        currentTurnIdx: state.currentTurnIdx,
        status: state.status,
        picks: state.picks,
        events: state.events,
      },
    })

    expect(restored.events).toHaveLength(1)
    expect(restored.events[0].type).toBe('shuffle')
  })
})
