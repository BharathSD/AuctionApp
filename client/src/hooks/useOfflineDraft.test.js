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
 * label (i.e. no merging) when not given explicitly.
 */
function runningState({ config, teams, players, categories, categoryGroups, pickOrder, currentCategoryIdx = 0, currentTurnIdx = 0 }) {
  return {
    config,
    teams,
    players,
    categories,
    categoryGroups: categoryGroups || categories.map(c => ({ roles: [c] })),
    currentCategoryIdx,
    pickOrder,
    currentTurnIdx,
    status: 'running',
    picks: [],
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

  it('is a no-op once the draft has started', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 1 }])
    let state = buildInitialState({ config: makeConfig(), teams, players })
    state = reducer(state, { type: 'RANDOMIZE_ORDER' })
    state = reducer(state, { type: 'START' })
    expect(state.status).toBe('running')

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
