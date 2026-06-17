'use strict'
const { describe, it, before, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const engine = require('../auction-engine')

// ─── Helpers ──────────────────────────────────────────────────

/** Minimal no-op io stub — engine emits but tests don't need socket output */
const io = { to: () => ({ emit: () => {} }) }

function makeConfig(overrides = {}) {
  return {
    numTeams: 2,
    pointsPerTeam: 1000,
    maxPlayersPerTeam: 3,
    bidTiers: [{ upTo: null, increment: 100 }],
    timerEnabled: false,
    timerSeconds: 30,
    ...overrides,
  }
}

function makeTeams(count = 2, budget = 1000) {
  return Array.from({ length: count }, (_, i) => ({
    id: `team${i + 1}`,
    name: `Team ${i + 1}`,
    pin: `100${i + 1}`,
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

/** Creates a fresh room, wires up given players, and returns the roomCode */
function setupRoom(code, config, teams, players) {
  engine.createRoom(code, { config, teams, players })
  return code
}

// ─── createRoom ───────────────────────────────────────────────

describe('createRoom', () => {
  it('stores the room and queues only pending players', () => {
    const players = makePlayers([100, 200, 300])
    players[0].status = 'sold' // pre-allocated
    const code = 'CR01'
    setupRoom(code, makeConfig(), makeTeams(), players)
    const room = engine.getRoom(code)
    assert.equal(room.queue.length, 2)
    assert.deepEqual(room.queue, [1, 2])
  })

  it('excludes pre-sold players from queue', () => {
    const players = makePlayers([100, 200])
    players.forEach(p => { p.status = 'sold' })
    setupRoom('CR02', makeConfig(), makeTeams(), players)
    assert.equal(engine.getRoom('CR02').queue.length, 0)
  })
})

// ─── joinRoom ─────────────────────────────────────────────────

describe('joinRoom', () => {
  before(() => setupRoom('JR01', makeConfig(), makeTeams(), makePlayers([100])))

  it('returns team on correct PIN', () => {
    const result = engine.joinRoom('JR01', '1001')
    assert.equal(result.team.id, 'team1')
  })

  it('returns error on wrong PIN', () => {
    const result = engine.joinRoom('JR01', '9999')
    assert.ok(result.error)
  })

  it('returns error for unknown room', () => {
    const result = engine.joinRoom('NOPE', '1001')
    assert.ok(result.error)
  })
})

// ─── startNextPlayer ──────────────────────────────────────────

describe('startNextPlayer', () => {
  beforeEach(() => {
    setupRoom('SN01', makeConfig(), makeTeams(), makePlayers([100, 200, 300]))
  })

  it('sets status to running and currentPrice to basePrice', () => {
    const state = engine.startNextPlayer('SN01', io)
    assert.equal(state.status, 'running')
    assert.equal(state.currentPrice, 100)
  })

  it('advances to next player on second call', () => {
    engine.startNextPlayer('SN01', io)
    engine.startNextPlayer('SN01', io)
    const room = engine.getRoom('SN01')
    assert.equal(room.currentIdx, 1)
    assert.equal(room.currentPrice, 200)
  })

  it('returns error for unknown room', () => {
    const result = engine.startNextPlayer('NOPE', io)
    assert.ok(result.error)
  })
})

// ─── placeBid ─────────────────────────────────────────────────

describe('placeBid', () => {
  beforeEach(() => {
    setupRoom('PB01', makeConfig(), makeTeams(2, 1000), makePlayers([100, 200, 300]))
    engine.startNextPlayer('PB01', io)
  })

  it('accepts a valid first bid at base price', () => {
    const result = engine.placeBid('PB01', 'team1', io)
    assert.deepEqual(result, { ok: true })
    assert.equal(engine.getRoom('PB01').currentPrice, 100)
    assert.equal(engine.getRoom('PB01').leadingTeamId, 'team1')
  })

  it('accepts a valid raised bid at current + increment', () => {
    engine.placeBid('PB01', 'team1', io)    // 100
    const result = engine.placeBid('PB01', 'team2', io)  // 200
    assert.deepEqual(result, { ok: true })
    assert.equal(engine.getRoom('PB01').currentPrice, 200)
  })

  it('rejects bid from already-leading team', () => {
    engine.placeBid('PB01', 'team1', io)
    const result = engine.placeBid('PB01', 'team1', io)
    assert.ok(result.error)
    assert.match(result.error, /already leading/i)
  })

  it('rejects bid when team budget is insufficient', () => {
    // Give team1 only 50 budget — can't cover basePrice 100
    setupRoom('PB02', makeConfig(), makeTeams(2, 50), makePlayers([100, 200, 300]))
    engine.startNextPlayer('PB02', io)
    const result = engine.placeBid('PB02', 'team1', io)
    assert.ok(result.error)
    assert.match(result.error, /budget/i)
  })

  it('rejects bid when auction is not running', () => {
    const result = engine.placeBid('PB01', 'team1', io) // ok first bid
    // finish auction
    engine.finishAuction('PB01', io)
    const result2 = engine.placeBid('PB01', 'team2', io)
    assert.ok(result2.error)
  })

  it('rejects bid when auction is paused', () => {
    engine.pauseAuction('PB01', io)
    const result = engine.placeBid('PB01', 'team1', io)
    assert.ok(result.error)
    assert.match(result.error, /paused/i)
  })

  it('rejects bid when roster is full', () => {
    // Fill team1 to maxPlayersPerTeam (3) manually
    const room = engine.getRoom('PB01')
    room.teams[0].players = [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }]
    const result = engine.placeBid('PB01', 'team1', io)
    assert.ok(result.error)
    assert.match(result.error, /roster/i)
  })

  it('rejects bid on unknown room', () => {
    const result = engine.placeBid('NOPE', 'team1', io)
    assert.ok(result.error)
  })

  // ── Roster affordability (new feature) ───────────────────────

  describe('roster affordability check', () => {
    it('allows bid when team can cover remaining spots at base prices', () => {
      // Players: [100, 200, 300], max=3, budget=1000
      // Bidding on player[0] at 100: after win budget=900, still needs 200+300=500 ✓
      const result = engine.placeBid('PB01', 'team1', io)
      assert.deepEqual(result, { ok: true })
    })

    it('blocks bid when winning this player leaves too little for remaining spots', () => {
      // Players: [100, 200, 300], max=3, budget=350
      // Bidding on player[0] at 100: after win budget=250, still needs 200+300=500 ✗
      setupRoom('PB_AFF1', makeConfig(), makeTeams(2, 350), makePlayers([100, 200, 300]))
      engine.startNextPlayer('PB_AFF1', io)
      const result = engine.placeBid('PB_AFF1', 'team1', io)
      assert.ok(result.error)
      assert.match(result.error, /roster/i)
    })

    it('blocks when a raised bid would violate the affordability constraint', () => {
      // Players: [100, 200, 300, 400], max=3, budget=700
      // player[0]=100, spots after=2, cheapest remaining excl. current = 200+300=500
      // First bid ok: 700-100=600 >= 500 ✓
      // Second bid (after raise to 200): 700-200=500 >= 500 ✓ (edge case, exactly enough)
      // Third bid (raise to 300): 700-300=400 < 500 ✗
      setupRoom('PB_AFF2', makeConfig({ maxPlayersPerTeam: 3 }), makeTeams(2, 700), makePlayers([100, 200, 300, 400]))
      engine.startNextPlayer('PB_AFF2', io)
      engine.placeBid('PB_AFF2', 'team1', io) // 100 — ok
      engine.placeBid('PB_AFF2', 'team2', io) // 200 — ok
      const result = engine.placeBid('PB_AFF2', 'team1', io) // 300
      // 700 - 300 = 400, needs 200+300=500 → blocked
      assert.ok(result.error)
    })

    it('skips the affordability check when maxPlayersPerTeam is 0 (unconstrained)', () => {
      setupRoom('PB_AFF3', makeConfig({ maxPlayersPerTeam: 0 }), makeTeams(2, 150), makePlayers([100, 200, 300]))
      engine.startNextPlayer('PB_AFF3', io)
      // budget=150, bidding on player at 100; would fail affordability if enabled
      const result = engine.placeBid('PB_AFF3', 'team1', io)
      assert.deepEqual(result, { ok: true })
    })

    it('allows bid on last roster spot (no remaining spots needed)', () => {
      // team1 already has 2 players, max=3 → winning this fills the roster
      setupRoom('PB_AFF4', makeConfig({ maxPlayersPerTeam: 3 }), makeTeams(2, 1000), makePlayers([100, 200, 300]))
      const room = engine.getRoom('PB_AFF4')
      room.teams[0].players = [{ id: 'x1' }, { id: 'x2' }]
      engine.startNextPlayer('PB_AFF4', io)
      // spotsNeededAfter = 3 - 2 - 1 = 0 → minNeeded = 0 → always passes
      const result = engine.placeBid('PB_AFF4', 'team1', io)
      assert.deepEqual(result, { ok: true })
    })
  })
})

// ─── sellPlayer ───────────────────────────────────────────────

describe('sellPlayer', () => {
  beforeEach(() => {
    setupRoom('SP01', makeConfig(), makeTeams(2, 1000), makePlayers([100, 200, 300]))
    engine.startNextPlayer('SP01', io)
    engine.placeBid('SP01', 'team1', io)
  })

  it('deducts price from winning team budget', () => {
    engine.sellPlayer('SP01', io)
    const room = engine.getRoom('SP01')
    assert.equal(room.teams[0].budget, 900)
    assert.equal(room.teams[0].spent, 100)
  })

  it('adds player to winning team roster', () => {
    engine.sellPlayer('SP01', io)
    const room = engine.getRoom('SP01')
    assert.equal(room.teams[0].players.length, 1)
    assert.equal(room.teams[0].players[0].soldPrice, 100)
  })

  it('marks player as sold with correct soldTo', () => {
    engine.sellPlayer('SP01', io)
    const room = engine.getRoom('SP01')
    assert.equal(room.players[0].status, 'sold')
    assert.equal(room.players[0].soldTo, 'team1')
  })

  it('sets status to finished when all rosters are full', () => {
    const room = engine.getRoom('SP01')
    // team2 is already full (3/3), team1 has 2 — selling to team1 fills everyone
    room.teams[0].players = [{ id: 'x1' }, { id: 'x2' }]          // team1: 2/3
    room.teams[1].players = [{ id: 'y1' }, { id: 'y2' }, { id: 'y3' }] // team2: 3/3 (full)
    engine.sellPlayer('SP01', io)
    assert.equal(engine.getRoom('SP01').status, 'finished')
  })

  it('returns error when no leading bid exists', () => {
    setupRoom('SP02', makeConfig(), makeTeams(), makePlayers([100]))
    engine.startNextPlayer('SP02', io)
    // no bids placed
    const result = engine.sellPlayer('SP02', io)
    assert.ok(result.error)
  })
})

// ─── undoBid ──────────────────────────────────────────────────

describe('undoBid', () => {
  beforeEach(() => {
    setupRoom('UB01', makeConfig(), makeTeams(2, 1000), makePlayers([100, 200]))
    engine.startNextPlayer('UB01', io)
  })

  it('removes latest bid and reverts price', () => {
    engine.placeBid('UB01', 'team1', io) // 100
    engine.placeBid('UB01', 'team2', io) // 200
    engine.undoBid('UB01', io)
    const room = engine.getRoom('UB01')
    assert.equal(room.currentPrice, 100)
    assert.equal(room.leadingTeamId, 'team1')
  })

  it('reverts to basePrice and null leader when all bids undone', () => {
    engine.placeBid('UB01', 'team1', io)
    engine.undoBid('UB01', io)
    const room = engine.getRoom('UB01')
    assert.equal(room.currentPrice, 100)
    assert.equal(room.leadingTeamId, null)
  })

  it('returns error when there are no bids to undo', () => {
    const result = engine.undoBid('UB01', io)
    assert.ok(result.error)
  })

  it('returns error when auction is not running', () => {
    engine.finishAuction('UB01', io)
    const result = engine.undoBid('UB01', io)
    assert.ok(result.error)
  })
})

// ─── unsellPlayer ─────────────────────────────────────────────

describe('unsellPlayer', () => {
  beforeEach(() => {
    setupRoom('US01', makeConfig(), makeTeams(), makePlayers([100]))
    engine.startNextPlayer('US01', io)
  })

  it('marks current player as unsold', () => {
    engine.unsellPlayer('US01', io)
    const room = engine.getRoom('US01')
    assert.equal(room.players[0].status, 'unsold')
    assert.equal(room.status, 'unsold')
  })
})

// ─── pauseAuction / resumeAuction ─────────────────────────────

describe('pauseAuction / resumeAuction', () => {
  beforeEach(() => {
    setupRoom('PA01', makeConfig(), makeTeams(), makePlayers([100]))
    engine.startNextPlayer('PA01', io)
  })

  it('sets paused flag to true', () => {
    engine.pauseAuction('PA01', io)
    assert.equal(engine.getRoom('PA01').paused, true)
  })

  it('clears paused flag on resume', () => {
    engine.pauseAuction('PA01', io)
    engine.resumeAuction('PA01', io)
    assert.equal(engine.getRoom('PA01').paused, false)
  })

  it('rejects pause when not running', () => {
    engine.finishAuction('PA01', io)
    const result = engine.pauseAuction('PA01', io)
    assert.ok(result.error)
  })

  it('rejects resume when not paused', () => {
    const result = engine.resumeAuction('PA01', io)
    assert.ok(result.error)
  })
})

// ─── startNextPlayer: second round and finish ─────────────────

describe('startNextPlayer: round transitions', () => {
  it('auto-starts second round with unsold players after queue exhaustion', () => {
    setupRoom('RND01', makeConfig(), makeTeams(), makePlayers([100, 200]))
    engine.startNextPlayer('RND01', io)     // player 0 on block
    engine.unsellPlayer('RND01', io)        // mark unsold
    engine.startNextPlayer('RND01', io)     // player 1 on block
    engine.unsellPlayer('RND01', io)        // mark unsold
    const state = engine.startNextPlayer('RND01', io) // queue exhausted → second round
    assert.equal(state.secondRound, true)
    assert.equal(state.status, 'running')
  })

  it('finishes auction when queue is exhausted in second round', () => {
    setupRoom('RND02', makeConfig(), makeTeams(), makePlayers([100]))
    engine.startNextPlayer('RND02', io)
    engine.unsellPlayer('RND02', io)
    engine.startNextPlayer('RND02', io) // second round starts
    engine.unsellPlayer('RND02', io)
    const result = engine.startNextPlayer('RND02', io)
    assert.equal(result.status, 'finished')
  })

  it('finishes auction immediately when all players are sold and no unsold exist', () => {
    setupRoom('RND03', makeConfig(), makeTeams(2, 1000), makePlayers([100]))
    engine.startNextPlayer('RND03', io)
    engine.placeBid('RND03', 'team1', io)
    engine.sellPlayer('RND03', io)
    const result = engine.startNextPlayer('RND03', io)
    assert.equal(result.status, 'finished')
  })
})

// ─── requeueUnsold ────────────────────────────────────────────

describe('requeueUnsold', () => {
  it('re-adds unsold players to the queue as pending', () => {
    setupRoom('RQ01', makeConfig(), makeTeams(), makePlayers([100, 200]))
    engine.startNextPlayer('RQ01', io)
    engine.unsellPlayer('RQ01', io)
    engine.startNextPlayer('RQ01', io)
    engine.unsellPlayer('RQ01', io)
    engine.requeueUnsold('RQ01', io)
    const room = engine.getRoom('RQ01')
    assert.equal(room.players.filter(p => p.status === 'pending').length, 2)
    assert.equal(room.status, 'idle')
  })

  it('returns error when no unsold players exist', () => {
    setupRoom('RQ02', makeConfig(), makeTeams(), makePlayers([100]))
    const result = engine.requeueUnsold('RQ02', io)
    assert.ok(result.error)
  })
})

// ─── finishAuction ────────────────────────────────────────────

describe('finishAuction', () => {
  it('sets status to finished', () => {
    setupRoom('FA01', makeConfig(), makeTeams(), makePlayers([100]))
    engine.startNextPlayer('FA01', io)
    engine.finishAuction('FA01', io)
    assert.equal(engine.getRoom('FA01').status, 'finished')
  })
})

// ─── publicState / viewerState ────────────────────────────────

describe('publicState', () => {
  it('strips team PINs from broadcast state', () => {
    setupRoom('PS01', makeConfig(), makeTeams(), makePlayers([100]))
    const room = engine.getRoom('PS01')
    const state = engine.publicState(room)
    state.teams.forEach(t => assert.equal(t.pin, undefined))
  })
})

describe('viewerState', () => {
  it('replaces budget with budgetPct and omits raw budget', () => {
    setupRoom('VS01', makeConfig({ pointsPerTeam: 1000 }), makeTeams(2, 1000), makePlayers([100]))
    const room = engine.getRoom('VS01')
    const state = engine.viewerState(room)
    state.teams.forEach(t => {
      assert.equal(typeof t.budgetPct, 'number')
      assert.equal(t.budget, undefined)
    })
  })
})

// ─── checkCaptainJoin ─────────────────────────────────────────

describe('checkCaptainJoin', () => {
  it('allows first-time join', () => {
    setupRoom('CJ01', makeConfig(), makeTeams(), makePlayers([100]))
    assert.equal(engine.checkCaptainJoin('CJ01', 'team1'), null)
  })

  it('rejects join when captain already has an active socket', () => {
    setupRoom('CJ02', makeConfig(), makeTeams(), makePlayers([100]))
    engine.connectCaptain('CJ02', 'team1', 'sock1', io)
    assert.equal(engine.checkCaptainJoin('CJ02', 'team1'), 'already_connected')
  })

  it('returns room not found for unknown room', () => {
    assert.equal(engine.checkCaptainJoin('NOPE', 'team1'), 'Room not found')
  })
})
