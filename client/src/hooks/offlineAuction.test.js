import { describe, it, expect } from 'vitest'
import { _reducer as reducer, _buildInitialState as buildInitialState } from '../hooks/useOfflineAuction'

// ─── Helpers ──────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    maxPlayersPerTeam: 3,
    bidTiers: [{ upTo: null, increment: 100 }],
    timerEnabled: false,
    timerSeconds: 30,
    pointsPerTeam: 1000,
    ...overrides,
  }
}

function makeTeams(count = 2, budget = 1000) {
  return Array.from({ length: count }, (_, i) => ({
    id: `team${i + 1}`,
    name: `Team ${i + 1}`,
    budget,
    spent: 0,
    players: [],
  }))
}

function makePlayers(basePrices) {
  return basePrices.map((bp, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    role: 'Batsman',
    basePrice: bp,
    status: 'pending',
  }))
}

/** Build a running state with the first player on the block */
function runningState(config, teams, players, currentIdx = 0) {
  const queue = players.reduce((acc, p, i) => p.status === 'pending' ? [...acc, i] : acc, [])
  return {
    config,
    teams,
    players,
    queue,
    currentIdx,
    currentPrice: players[queue[currentIdx]].basePrice,
    leadingTeamId: null,
    bids: [],
    status: 'running',
    timerLeft: config.timerEnabled ? config.timerSeconds : null,
    paused: false,
    secondRound: false,
  }
}

// ─── buildInitialState ────────────────────────────────────────

describe('buildInitialState', () => {
  it('queues only pending players', () => {
    const players = makePlayers([100, 200, 300])
    players[0].status = 'sold'
    const state = buildInitialState({ config: makeConfig(), teams: makeTeams(), players })
    expect(state.queue).toEqual([1, 2])
  })

  it('restores from persisted _runtime snapshot', () => {
    const state = buildInitialState({
      config: makeConfig(),
      teams: makeTeams(),
      players: makePlayers([100]),
      _runtime: {
        queue: [0],
        currentIdx: 0,
        currentPrice: 150,
        leadingTeamId: 'team1',
        bids: [{ teamId: 'team1', price: 150 }],
        status: 'running',
        secondRound: false,
      },
    })
    expect(state.currentPrice).toBe(150)
    expect(state.leadingTeamId).toBe('team1')
    expect(state.status).toBe('running')
  })
})

// ─── NEXT_PLAYER ──────────────────────────────────────────────

describe('NEXT_PLAYER', () => {
  it('starts the first player (advance: false)', () => {
    const state = {
      config: makeConfig(),
      teams: makeTeams(),
      players: makePlayers([100, 200]),
      queue: [0, 1],
      currentIdx: 0,
      currentPrice: null,
      leadingTeamId: null,
      bids: [],
      status: 'idle',
      timerLeft: null,
      paused: false,
      secondRound: false,
    }
    const next = reducer(state, { type: 'NEXT_PLAYER', advance: false })
    expect(next.status).toBe('running')
    expect(next.currentPrice).toBe(100)
    expect(next.currentIdx).toBe(0)
  })

  it('advances to next player (advance: true)', () => {
    const state = runningState(makeConfig(), makeTeams(), makePlayers([100, 200]))
    const next = reducer(state, { type: 'NEXT_PLAYER', advance: true })
    expect(next.currentIdx).toBe(1)
    expect(next.currentPrice).toBe(200)
  })

  it('auto-starts second round when queue exhausted with unsold players', () => {
    const players = makePlayers([100, 200])
    players[0].status = 'unsold'
    const state = {
      ...runningState(makeConfig(), makeTeams(), [players[1]], 0),
      players,
      queue: [1],
      currentIdx: 0,
      secondRound: false,
    }
    const next = reducer(state, { type: 'NEXT_PLAYER', advance: true })
    expect(next.secondRound).toBe(true)
    expect(next.status).toBe('running')
  })

  it('finishes when queue exhausted and no unsold players', () => {
    const state = {
      ...runningState(makeConfig(), makeTeams(), makePlayers([100])),
      queue: [0],
      currentIdx: 0,
    }
    const next = reducer(state, { type: 'NEXT_PLAYER', advance: true })
    expect(next.status).toBe('finished')
  })

  it('finishes when queue exhausted in second round', () => {
    const state = {
      ...runningState(makeConfig(), makeTeams(), makePlayers([100])),
      queue: [0],
      currentIdx: 0,
      secondRound: true,
    }
    const next = reducer(state, { type: 'NEXT_PLAYER', advance: true })
    expect(next.status).toBe('finished')
  })
})

// ─── BID ──────────────────────────────────────────────────────

describe('BID', () => {
  it('accepts a valid first bid at base price', () => {
    const state = runningState(makeConfig(), makeTeams(), makePlayers([100, 200, 300]))
    const next = reducer(state, { type: 'BID', teamId: 'team1' })
    expect(next.currentPrice).toBe(100)
    expect(next.leadingTeamId).toBe('team1')
    expect(next.bids).toHaveLength(1)
  })

  it('raises price by increment on subsequent bid', () => {
    const state = runningState(makeConfig(), makeTeams(), makePlayers([100, 200, 300]))
    const s1 = reducer(state, { type: 'BID', teamId: 'team1' })  // 100
    const s2 = reducer(s1,    { type: 'BID', teamId: 'team2' })  // 200
    expect(s2.currentPrice).toBe(200)
    expect(s2.leadingTeamId).toBe('team2')
  })

  it('ignores bid from already-leading team', () => {
    const state = runningState(makeConfig(), makeTeams(), makePlayers([100, 200, 300]))
    const s1 = reducer(state, { type: 'BID', teamId: 'team1' })
    const s2 = reducer(s1,    { type: 'BID', teamId: 'team1' })
    expect(s2).toBe(s1) // same reference — state unchanged
  })

  it('ignores bid when team has insufficient budget', () => {
    const teams = makeTeams(2, 50) // budget too low for 100
    const state = runningState(makeConfig(), teams, makePlayers([100, 200, 300]))
    const next = reducer(state, { type: 'BID', teamId: 'team1' })
    expect(next.leadingTeamId).toBeNull()
  })

  it('ignores bid when auction is paused', () => {
    const state = { ...runningState(makeConfig(), makeTeams(), makePlayers([100, 200, 300])), paused: true }
    const next = reducer(state, { type: 'BID', teamId: 'team1' })
    expect(next.leadingTeamId).toBeNull()
  })

  it('ignores bid when auction is not running', () => {
    const state = { ...runningState(makeConfig(), makeTeams(), makePlayers([100, 200, 300])), status: 'sold' }
    const next = reducer(state, { type: 'BID', teamId: 'team1' })
    expect(next.leadingTeamId).toBeNull()
  })

  it('ignores bid when team roster is full', () => {
    const teams = makeTeams()
    teams[0].players = [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }] // full at max=3
    const state = runningState(makeConfig(), teams, makePlayers([100, 200, 300]))
    const next = reducer(state, { type: 'BID', teamId: 'team1' })
    expect(next.leadingTeamId).toBeNull()
  })

  // ── Roster affordability ──────────────────────────────────────

  it('allows bid when team can cover remaining roster spots', () => {
    // budget=1000, bid=100, remaining need=200+300=500 → 900 >= 500 ✓
    const state = runningState(makeConfig(), makeTeams(2, 1000), makePlayers([100, 200, 300]))
    const next = reducer(state, { type: 'BID', teamId: 'team1' })
    expect(next.leadingTeamId).toBe('team1')
  })

  it('blocks bid when team cannot cover remaining roster spots', () => {
    // budget=350, bid=100, remaining need=200+300=500 → 250 < 500 ✗
    const state = runningState(makeConfig(), makeTeams(2, 350), makePlayers([100, 200, 300]))
    const next = reducer(state, { type: 'BID', teamId: 'team1' })
    expect(next.leadingTeamId).toBeNull()
  })

  it('skips affordability check when maxPlayersPerTeam is 0', () => {
    const state = runningState(makeConfig({ maxPlayersPerTeam: 0 }), makeTeams(2, 150), makePlayers([100, 200, 300]))
    const next = reducer(state, { type: 'BID', teamId: 'team1' })
    expect(next.leadingTeamId).toBe('team1')
  })

  it('allows bid on final roster spot (zero remaining spots needed)', () => {
    const teams = makeTeams()
    teams[0].players = [{ id: 'x1' }, { id: 'x2' }] // 2 of 3 filled
    const state = runningState(makeConfig(), teams, makePlayers([100, 200, 300]))
    // spotsNeededAfter = 3 - 2 - 1 = 0 → minNeeded = 0 → always passes
    const next = reducer(state, { type: 'BID', teamId: 'team1' })
    expect(next.leadingTeamId).toBe('team1')
  })
})

// ─── UNDO_BID ─────────────────────────────────────────────────

describe('UNDO_BID', () => {
  it('reverts to previous bidder and price', () => {
    const s0 = runningState(makeConfig(), makeTeams(), makePlayers([100, 200]))
    const s1 = reducer(s0, { type: 'BID', teamId: 'team1' }) // 100
    const s2 = reducer(s1, { type: 'BID', teamId: 'team2' }) // 200
    const s3 = reducer(s2, { type: 'UNDO_BID' })
    expect(s3.currentPrice).toBe(100)
    expect(s3.leadingTeamId).toBe('team1')
    expect(s3.bids).toHaveLength(1)
  })

  it('reverts to base price and null leader when undoing the only bid', () => {
    const s0 = runningState(makeConfig(), makeTeams(), makePlayers([100, 200]))
    const s1 = reducer(s0, { type: 'BID', teamId: 'team1' })
    const s2 = reducer(s1, { type: 'UNDO_BID' })
    expect(s2.currentPrice).toBe(100) // basePrice
    expect(s2.leadingTeamId).toBeNull()
  })

  it('ignores undo when no bids exist', () => {
    const state = runningState(makeConfig(), makeTeams(), makePlayers([100]))
    const next = reducer(state, { type: 'UNDO_BID' })
    expect(next).toBe(state)
  })

  it('ignores undo when auction is not running', () => {
    const s0 = runningState(makeConfig(), makeTeams(), makePlayers([100]))
    const s1 = reducer(s0, { type: 'BID', teamId: 'team1' })
    const s2 = { ...s1, status: 'sold' }
    const s3 = reducer(s2, { type: 'UNDO_BID' })
    expect(s3).toBe(s2)
  })
})

// ─── SOLD ─────────────────────────────────────────────────────

describe('SOLD', () => {
  it('deducts price from winning team and adds player to roster', () => {
    const s0 = runningState(makeConfig(), makeTeams(), makePlayers([100, 200, 300]))
    const s1 = reducer(s0, { type: 'BID', teamId: 'team1' })
    const s2 = reducer(s1, { type: 'SOLD' })
    const team1 = s2.teams.find(t => t.id === 'team1')
    expect(team1.budget).toBe(900)
    expect(team1.spent).toBe(100)
    expect(team1.players).toHaveLength(1)
    expect(team1.players[0].soldPrice).toBe(100)
  })

  it('marks player as sold with correct soldTo', () => {
    const s0 = runningState(makeConfig(), makeTeams(), makePlayers([100, 200, 300]))
    const s1 = reducer(s0, { type: 'BID', teamId: 'team1' })
    const s2 = reducer(s1, { type: 'SOLD' })
    expect(s2.players[0].status).toBe('sold')
    expect(s2.players[0].soldTo).toBe('team1')
  })

  it('sets status to sold (not finished) when rosters not yet full', () => {
    const s0 = runningState(makeConfig(), makeTeams(), makePlayers([100, 200, 300]))
    const s1 = reducer(s0, { type: 'BID', teamId: 'team1' })
    const s2 = reducer(s1, { type: 'SOLD' })
    expect(s2.status).toBe('sold')
  })

  it('auto-finishes when all rosters reach maxPlayersPerTeam', () => {
    const teams = makeTeams(2, 1000)
    teams[0].players = [{ id: 'x1' }, { id: 'x2' }] // 2 of 3
    teams[1].players = [{ id: 'y1' }, { id: 'y2' }, { id: 'y3' }] // already full
    const s0 = runningState(makeConfig(), teams, makePlayers([100, 200, 300]))
    const s1 = reducer(s0, { type: 'BID', teamId: 'team1' })
    const s2 = reducer(s1, { type: 'SOLD' }) // team1 now at 3/3
    expect(s2.status).toBe('finished')
  })

  it('ignores SOLD when no leading team', () => {
    const state = runningState(makeConfig(), makeTeams(), makePlayers([100]))
    const next = reducer(state, { type: 'SOLD' })
    expect(next).toBe(state)
  })
})

// ─── UNSOLD ───────────────────────────────────────────────────

describe('UNSOLD', () => {
  it('marks current player as unsold', () => {
    const state = runningState(makeConfig(), makeTeams(), makePlayers([100]))
    const next = reducer(state, { type: 'UNSOLD' })
    expect(next.players[0].status).toBe('unsold')
    expect(next.status).toBe('unsold')
  })
})

// ─── PAUSE / RESUME ───────────────────────────────────────────

describe('PAUSE / RESUME', () => {
  it('sets paused flag on PAUSE', () => {
    const state = runningState(makeConfig(), makeTeams(), makePlayers([100]))
    expect(reducer(state, { type: 'PAUSE' }).paused).toBe(true)
  })

  it('clears paused flag on RESUME', () => {
    const state = { ...runningState(makeConfig(), makeTeams(), makePlayers([100])), paused: true }
    expect(reducer(state, { type: 'RESUME' }).paused).toBe(false)
  })
})

// ─── TICK ─────────────────────────────────────────────────────

describe('TICK', () => {
  const timerConfig = makeConfig({ timerEnabled: true, timerSeconds: 30 })

  it('decrements timerLeft by 1', () => {
    const state = { ...runningState(timerConfig, makeTeams(), makePlayers([100])), timerLeft: 15 }
    const next = reducer(state, { type: 'TICK' })
    expect(next.timerLeft).toBe(14)
  })

  it('sets timerLeft to 0 when at 1 (signals auto-resolve)', () => {
    const state = { ...runningState(timerConfig, makeTeams(), makePlayers([100])), timerLeft: 1 }
    const next = reducer(state, { type: 'TICK' })
    expect(next.timerLeft).toBe(0)
  })

  it('does not tick when paused', () => {
    const state = { ...runningState(timerConfig, makeTeams(), makePlayers([100])), timerLeft: 15, paused: true }
    const next = reducer(state, { type: 'TICK' })
    expect(next.timerLeft).toBe(15)
  })

  it('does not tick when timer is disabled', () => {
    const state = { ...runningState(makeConfig({ timerEnabled: false }), makeTeams(), makePlayers([100])), timerLeft: 15 }
    const next = reducer(state, { type: 'TICK' })
    expect(next.timerLeft).toBe(15)
  })

  it('does not tick when status is not running', () => {
    const state = {
      ...runningState(timerConfig, makeTeams(), makePlayers([100])),
      timerLeft: 15,
      status: 'sold',
    }
    const next = reducer(state, { type: 'TICK' })
    expect(next.timerLeft).toBe(15)
  })
})

// ─── REQUEUE_UNSOLD ───────────────────────────────────────────

describe('REQUEUE_UNSOLD', () => {
  it('appends unsold players to queue and resets to idle', () => {
    const players = makePlayers([100, 200, 300])
    players[0].status = 'unsold'
    const state = {
      ...runningState(makeConfig(), makeTeams(), players, 1),
      queue: [0, 1, 2],
      currentIdx: 1,
    }
    const next = reducer(state, { type: 'REQUEUE_UNSOLD' })
    expect(next.status).toBe('idle')
    expect(next.currentIdx).toBe(-1)
    expect(next.queue).toContain(0) // unsold player re-queued
  })
})

// ─── FINISH ───────────────────────────────────────────────────

describe('FINISH', () => {
  it('sets status to finished', () => {
    const state = runningState(makeConfig(), makeTeams(), makePlayers([100]))
    const next = reducer(state, { type: 'FINISH' })
    expect(next.status).toBe('finished')
  })
})
