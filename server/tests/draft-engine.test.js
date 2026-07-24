'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const engine = require('../auction-engine')

// ─── Helpers ──────────────────────────────────────────────────

/** Minimal no-op io stub — engine emits but tests don't need socket output */
const io = { to: () => ({ emit: () => {} }) }

function makeConfig(overrides = {}) {
  return {
    numTeams: 2,
    engine: 'draft',
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
    pin: `100${i + 1}`,
    players: [],
  }))
}

function makePlayers(spec) {
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

// Creates a room only — pick order is left unset, matching what
// createDraftRoom actually does now. Use this when a test cares about the
// pre-order state; use setupDraftRoom (below) for everything else.
function createOnlyDraftRoom(code, config, teams, players) {
  engine.createDraftRoom(code, { config, teams, players })
  return code
}

// Creates a room AND randomizes its pick order — the "ready to start" state
// most tests actually want, since startDraft now requires an order to be set.
function setupDraftRoom(code, config, teams, players) {
  createOnlyDraftRoom(code, config, teams, players)
  engine.randomizePickOrder(code, io)
  return code
}

// Creates a room with a fixed (non-randomized) pick order — for tests that
// need a specific team's position in the order to be deterministic, since
// randomizePickOrder's shuffle would otherwise make "does team1 get
// evaluated first" flaky.
function setupDraftRoomWithOrder(code, config, teams, players, pickOrder) {
  createOnlyDraftRoom(code, config, teams, players)
  engine.getRoom(code).pickOrder = pickOrder
  return code
}

// Picks the first available pending player on behalf of whichever team is
// currently on turn — used to drive a running draft forward step by step
// without hand-tracing exact (randomized) pick-order rotation.
function playCurrentTurn(code) {
  const room = engine.getRoom(code)
  const teamId = room.pickOrder[room.currentTurnIdx]
  const roles = room.categoryGroups[room.currentCategoryIdx]?.roles || []
  const player = room.players.find(p => p.status === 'pending' && roles.includes(p.role))
  return engine.pickPlayer(code, teamId, player.id, io)
}

// ─── createDraftRoom ──────────────────────────────────────────

describe('createDraftRoom', () => {
  it('derives categories from distinct pending player roles', () => {
    const players = makePlayers([{ role: 'Batsman', count: 2 }, { role: 'Bowler', count: 1 }])
    createOnlyDraftRoom('DCR01', makeConfig(), makeTeams(), players)
    const room = engine.getRoom('DCR01')
    assert.deepEqual([...room.categories].sort(), ['Batsman', 'Bowler'])
    assert.equal(room.status, 'idle')
  })

  it('starts with an empty pick order — only randomizePickOrder populates it', () => {
    const teams = makeTeams(3)
    createOnlyDraftRoom('DCR02', makeConfig({ numTeams: 3 }), teams, makePlayers([{ role: 'Batsman', count: 1 }]))
    const room = engine.getRoom('DCR02')
    assert.deepEqual(room.pickOrder, [])
  })

  it('uses config.categoryGroups verbatim when every category is present', () => {
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Bowler', count: 1 }])
    createOnlyDraftRoom('DCR03', makeConfig({ categoryGroups: [{ roles: ['Bowler'] }, { roles: ['Batsman'] }] }), makeTeams(), players)
    const room = engine.getRoom('DCR03')
    assert.deepEqual(room.categories, ['Bowler', 'Batsman'])
    assert.deepEqual(room.categoryGroups, [{ roles: ['Bowler'] }, { roles: ['Batsman'] }])
  })

  it('appends present categories missing from config.categoryGroups, and drops absent ones', () => {
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Bowler', count: 1 }])
    createOnlyDraftRoom('DCR04', makeConfig({ categoryGroups: [{ roles: ['Super Striker'] }, { roles: ['Batsman'] }] }), makeTeams(), players)
    const room = engine.getRoom('DCR04')
    assert.deepEqual(room.categories, ['Batsman', 'Bowler'])
  })

  it('joins merged roles into one combined category label', () => {
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Wicket-keeper', count: 1 }, { role: 'Bowler', count: 1 }])
    createOnlyDraftRoom('DCR05', makeConfig({ categoryGroups: [{ roles: ['Batsman', 'Wicket-keeper'] }, { roles: ['Bowler'] }] }), makeTeams(), players)
    const room = engine.getRoom('DCR05')
    assert.deepEqual(room.categories, ['Batsman + Wicket-keeper', 'Bowler'])
  })
})

// ─── randomizePickOrder ─────────────────────────────────────────

describe('randomizePickOrder', () => {
  it('populates the pick order with every team id exactly once', () => {
    const teams = makeTeams(3)
    createOnlyDraftRoom('DRP01', makeConfig({ numTeams: 3 }), teams, makePlayers([{ role: 'Batsman', count: 1 }]))
    const state = engine.randomizePickOrder('DRP01', io)
    assert.deepEqual([...state.pickOrder].sort(), teams.map(t => t.id).sort())
  })

  it('still allows reshuffling right after starting — start leaves currentTurnIdx at the round boundary (0)', () => {
    setupDraftRoom('DRP02', makeConfig(), makeTeams(), makePlayers([{ role: 'Batsman', count: 1 }]))
    engine.startDraft('DRP02', io)
    const result = engine.randomizePickOrder('DRP02', io)
    assert.equal(result.error, undefined)
  })

  it('rejects once a pick has moved the draft off the round boundary', () => {
    setupDraftRoom('DRP03', makeConfig(), makeTeams(3), makePlayers([{ role: 'Batsman', count: 3 }]))
    const started = engine.startDraft('DRP03', io)
    const player = engine.getRoom('DRP03').players.find(p => p.status === 'pending')
    engine.pickPlayer('DRP03', started.currentTurnTeamId, player.id, io)

    const result = engine.randomizePickOrder('DRP03', io)
    assert.ok(result.error)
  })
})

// ─── startDraft ───────────────────────────────────────────────

describe('startDraft', () => {
  it('transitions idle -> running and picks a valid starting turn', () => {
    setupDraftRoom('DST01', makeConfig(), makeTeams(), makePlayers([{ role: 'Batsman', count: 2 }]))
    const state = engine.startDraft('DST01', io)
    assert.equal(state.status, 'running')
    assert.ok(state.currentTurnTeamId)
    assert.equal(state.currentCategory, 'Batsman')
  })

  it('rejects starting a draft that is already running', () => {
    setupDraftRoom('DST02', makeConfig(), makeTeams(), makePlayers([{ role: 'Batsman', count: 1 }]))
    engine.startDraft('DST02', io)
    const result = engine.startDraft('DST02', io)
    assert.ok(result.error)
  })

  it('rejects when the pick order has not been set yet', () => {
    createOnlyDraftRoom('DST03', makeConfig(), makeTeams(), makePlayers([{ role: 'Batsman', count: 1 }]))
    const result = engine.startDraft('DST03', io)
    assert.ok(result.error)
  })
})

// ─── pickPlayer ───────────────────────────────────────────────

describe('pickPlayer', () => {
  it('assigns the player to the on-turn team and advances the turn', () => {
    setupDraftRoom('DPK01', makeConfig(), makeTeams(), makePlayers([{ role: 'Batsman', count: 2 }]))
    const started = engine.startDraft('DPK01', io)
    const onTurn = started.currentTurnTeamId
    const player = engine.getRoom('DPK01').players.find(p => p.status === 'pending')

    const result = engine.pickPlayer('DPK01', onTurn, player.id, io)

    assert.equal(result.error, undefined)
    const room = engine.getRoom('DPK01')
    const team = room.teams.find(t => t.id === onTurn)
    assert.equal(team.players.length, 1)
    assert.equal(room.players.find(p => p.id === player.id).status, 'sold')
    assert.notEqual(room.currentTurnTeamId, onTurn) // turn moved on
  })

  it('rejects a pick when it is not that team\'s turn', () => {
    setupDraftRoom('DPK02', makeConfig(), makeTeams(), makePlayers([{ role: 'Batsman', count: 1 }]))
    const started = engine.startDraft('DPK02', io)
    const offTurn = started.pickOrder.find(id => id !== started.currentTurnTeamId)
    const player = engine.getRoom('DPK02').players[0]

    const result = engine.pickPlayer('DPK02', offTurn, player.id, io)

    assert.equal(result.error, 'Not your turn')
  })

  it('rejects a pick from a different category than the current one', () => {
    setupDraftRoom('DPK03', makeConfig(), makeTeams(), makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Bowler', count: 1 }]))
    const started = engine.startDraft('DPK03', io)
    const otherCategoryPlayer = engine.getRoom('DPK03').players.find(p => p.role !== started.currentCategory)

    const result = engine.pickPlayer('DPK03', started.currentTurnTeamId, otherCategoryPlayer.id, io)

    assert.match(result.error, /current category/)
  })

  it('rejects picking an already-picked player', () => {
    setupDraftRoom('DPK04', makeConfig(), makeTeams(), makePlayers([{ role: 'Batsman', count: 2 }]))
    const started = engine.startDraft('DPK04', io)
    const player = engine.getRoom('DPK04').players[0]
    const afterFirst = engine.pickPlayer('DPK04', started.currentTurnTeamId, player.id, io)

    // Whoever's turn it is now, re-picking the same (already sold) player must fail.
    const result = engine.pickPlayer('DPK04', afterFirst.currentTurnTeamId, player.id, io)

    assert.equal(result.error, 'Player is not available')
  })

  it('rotates the pick order (first mover to last) after a full round', () => {
    setupDraftRoom('DPK05', makeConfig(), makeTeams(2), makePlayers([{ role: 'Batsman', count: 3 }]))
    const started = engine.startDraft('DPK05', io)
    const [first, second] = started.pickOrder
    const players = engine.getRoom('DPK05').players

    engine.pickPlayer('DPK05', first, players[0].id, io)
    const afterRound = engine.pickPlayer('DPK05', second, players[1].id, io)

    assert.deepEqual(afterRound.pickOrder, [second, first])
    assert.equal(afterRound.currentTurnTeamId, second)
  })

  it('advances to the next category once the current one is exhausted', () => {
    // Both categories have exactly 1 player, so whichever one the (random)
    // shuffle put first, a single pick exhausts it mid-round (2 teams) and
    // the draft must move on to the other category immediately.
    setupDraftRoom('DPK06', makeConfig(), makeTeams(2), makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Bowler', count: 1 }]))
    const started = engine.startDraft('DPK06', io)
    const player = engine.getRoom('DPK06').players.find(p => p.role === started.currentCategory)

    const result = engine.pickPlayer('DPK06', started.currentTurnTeamId, player.id, io)

    assert.notEqual(result.currentCategory, started.currentCategory)
    assert.equal(result.status, 'running')
  })

  it('finishes the draft once every category is exhausted', () => {
    setupDraftRoom('DPK07', makeConfig(), makeTeams(2), makePlayers([{ role: 'Batsman', count: 2 }]))
    const started = engine.startDraft('DPK07', io)
    const players = engine.getRoom('DPK07').players
    engine.pickPlayer('DPK07', started.pickOrder[0], players[0].id, io)
    const final = engine.pickPlayer('DPK07', started.pickOrder[1], players[1].id, io)

    assert.equal(final.status, 'finished')
  })

  it('skips a team whose roster is already at the cap', () => {
    const teams = makeTeams(2)
    teams[1].players = [
      { id: 'x', name: 'X', role: 'Batsman' },
      { id: 'y', name: 'Y', role: 'Batsman' },
    ]
    setupDraftRoom('DPK08', makeConfig({ maxPlayersPerTeam: 2 }), teams, makePlayers([{ role: 'Batsman', count: 2 }]))
    const started = engine.startDraft('DPK08', io)
    // team1 should be on the clock immediately since team2 starts capped.
    assert.equal(started.currentTurnTeamId, 'team1')

    const player = engine.getRoom('DPK08').players[0]
    const result = engine.pickPlayer('DPK08', 'team1', player.id, io)

    // team2 is still capped (2/2), so its turn is skipped and it loops back
    // to team1 — one more Batsman remains, so the draft is still running.
    // (The exact pickOrder array is rotation-relative to the initial random
    // shuffle, so only the resolved on-turn team is asserted here.)
    assert.equal(result.status, 'running')
    assert.equal(result.currentTurnTeamId, 'team1')
  })

  it('accepts a pick from either role in a merged category', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Wicket-keeper', count: 1 }])
    createOnlyDraftRoom('DPK09', makeConfig({ categoryGroups: [{ roles: ['Batsman', 'Wicket-keeper'] }] }), teams, players)
    engine.randomizePickOrder('DPK09', io)
    const started = engine.startDraft('DPK09', io)
    // The Wicket-keeper isn't an exact match to the merged label, but it's
    // in the group's role list, so it must be a valid pick.
    const wicketKeeper = engine.getRoom('DPK09').players.find(p => p.role === 'Wicket-keeper')

    const result = engine.pickPlayer('DPK09', started.currentTurnTeamId, wicketKeeper.id, io)

    assert.equal(result.error, undefined)
    assert.equal(engine.getRoom('DPK09').players.find(p => p.id === wicketKeeper.id).status, 'sold')
  })

  it('only advances past a merged category once every one of its roles is exhausted', () => {
    const teams = makeTeams(2)
    const players = makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Wicket-keeper', count: 1 }, { role: 'Bowler', count: 1 }])
    createOnlyDraftRoom('DPK10', makeConfig({ categoryGroups: [{ roles: ['Batsman', 'Wicket-keeper'] }, { roles: ['Bowler'] }] }), teams, players)
    engine.randomizePickOrder('DPK10', io)
    const started = engine.startDraft('DPK10', io)
    const batsman = engine.getRoom('DPK10').players.find(p => p.role === 'Batsman')

    // Only the Batsman is picked — the Wicket-keeper is still pending, so
    // the merged category must not advance yet.
    const result = engine.pickPlayer('DPK10', started.currentTurnTeamId, batsman.id, io)

    assert.equal(result.currentCategory, 'Batsman + Wicket-keeper')
  })
})

// ─── undoPick ─────────────────────────────────────────────────

describe('undoPick', () => {
  it('restores the exact turn/category position and player availability', () => {
    // Both categories have exactly 1 player, so whichever the shuffle put
    // first, a single pick exhausts it and advances the category — giving
    // undo something unambiguous to reverse regardless of shuffle order.
    setupDraftRoom('DUN01', makeConfig(), makeTeams(2), makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Bowler', count: 1 }]))
    const started = engine.startDraft('DUN01', io)
    const startCategory = started.currentCategory
    const onTurn = started.currentTurnTeamId
    const player = engine.getRoom('DUN01').players.find(p => p.role === startCategory)

    const afterPick = engine.pickPlayer('DUN01', onTurn, player.id, io)
    assert.notEqual(afterPick.currentCategory, startCategory) // category advanced

    const undone = engine.undoPick('DUN01', io)

    assert.equal(undone.currentCategory, startCategory)
    assert.equal(undone.currentTurnTeamId, onTurn)
    const room = engine.getRoom('DUN01')
    assert.equal(room.players.find(p => p.id === player.id).status, 'pending')
    assert.equal(room.teams.find(t => t.id === onTurn).players.length, 0)
  })

  it('errors when there is nothing to undo', () => {
    setupDraftRoom('DUN02', makeConfig(), makeTeams(), makePlayers([{ role: 'Batsman', count: 1 }]))
    engine.startDraft('DUN02', io)
    const result = engine.undoPick('DUN02', io)
    assert.ok(result.error)
  })
})

// ─── serializeRoom / hydrateRoom round-trip ────────────────────

describe('draft room persistence round-trip', () => {
  it('serializes and rehydrates a draft room without losing turn/category state', () => {
    setupDraftRoom('DPS01', makeConfig(), makeTeams(2), makePlayers([{ role: 'Batsman', count: 2 }]))
    const started = engine.startDraft('DPS01', io)
    const players = engine.getRoom('DPS01').players
    engine.pickPlayer('DPS01', started.currentTurnTeamId, players[0].id, io)

    const room = engine.getRoom('DPS01')
    const serialized = engine.serializeRoom(room)
    assert.equal(serialized.config.engine, 'draft')
    assert.ok(Array.isArray(serialized.picks))

    const rehydrated = engine.hydrateRoom('DPS01_HYDRATED', serialized)
    assert.equal(rehydrated.status, 'running')
    assert.deepEqual(rehydrated.categories, room.categories)
    assert.deepEqual(rehydrated.categoryGroups, room.categoryGroups)
    assert.deepEqual(rehydrated.pickOrder, room.pickOrder)
    assert.equal(rehydrated.picks.length, 1)
  })
})

// ─── retention skips (proportional to retained players in category) ────

describe('retention skips', () => {
  it('is a no-op for a team with no retained players in the category', () => {
    setupDraftRoom('RS01', makeConfig(), makeTeams(2), makePlayers([{ role: 'Batsman', count: 2 }]))
    const started = engine.startDraft('RS01', io)
    const room = engine.getRoom('RS01')
    assert.equal(room.categorySkips[started.currentTurnTeamId], 0)
  })

  it('skips exactly as many turns as the team has retained players, then picks normally', () => {
    const teams = makeTeams(3)
    teams[0].players = [ // team1 retained 2 Batsman before the draft started
      { id: 'r1', name: 'R1', role: 'Batsman' },
      { id: 'r2', name: 'R2', role: 'Batsman' },
    ]
    setupDraftRoomWithOrder('RS02', makeConfig({ numTeams: 3 }), teams, makePlayers([{ role: 'Batsman', count: 6 }]), ['team1', 'team2', 'team3'])
    engine.startDraft('RS02', io)

    let room = engine.getRoom('RS02')
    // One skip already consumed resolving the very first turn of the draft.
    assert.equal(room.categorySkips.team1, 1)
    assert.notEqual(room.pickOrder[room.currentTurnIdx], 'team1')

    let guard = 0
    while (room.categorySkips.team1 > 0 && guard < 10) {
      playCurrentTurn('RS02')
      room = engine.getRoom('RS02')
      guard += 1
    }
    assert.equal(room.categorySkips.team1, 0)
    assert.equal(room.teams.find(t => t.id === 'team1').players.length, 2) // still just the 2 retained

    guard = 0
    while (room.pickOrder[room.currentTurnIdx] !== 'team1' && guard < 20) {
      playCurrentTurn('RS02')
      room = engine.getRoom('RS02')
      guard += 1
    }
    assert.equal(room.pickOrder[room.currentTurnIdx], 'team1')

    const pending = room.players.find(p => p.status === 'pending' && p.role === 'Batsman')
    engine.pickPlayer('RS02', 'team1', pending.id, io)
    room = engine.getRoom('RS02')
    assert.equal(room.teams.find(t => t.id === 'team1').players.length, 3) // 2 retained + 1 drafted
  })

  it('is scoped per category — a team skipped in category A gets a fresh count in category B', () => {
    const teams = makeTeams(2)
    teams[0].players = [{ id: 'r1', name: 'R1', role: 'Batsman' }] // retained in Batsman only
    setupDraftRoom('RS03', makeConfig({ categoryGroups: [{ roles: ['Batsman'] }, { roles: ['Bowler'] }] }), teams,
      makePlayers([{ role: 'Batsman', count: 1 }, { role: 'Bowler', count: 2 }]))
    engine.startDraft('RS03', io)
    let room = engine.getRoom('RS03')
    assert.equal(room.currentCategoryIdx, 0)
    assert.notEqual(room.pickOrder[room.currentTurnIdx], 'team1') // skipped in Batsman

    // Whoever's turn it is takes the only Batsman, exhausting category 0
    // and advancing to category 1 (Bowler) mid-round.
    playCurrentTurn('RS03')
    room = engine.getRoom('RS03')
    assert.equal(room.currentCategoryIdx, 1)

    let guard = 0
    while (room.pickOrder[room.currentTurnIdx] !== 'team1' && guard < 5) {
      playCurrentTurn('RS03')
      room = engine.getRoom('RS03')
      guard += 1
    }
    assert.equal(room.pickOrder[room.currentTurnIdx], 'team1')
    assert.equal(room.categorySkips.team1, 0) // no retained Bowlers — no skip owed here
  })

  it('counts a retained player toward the skip total if its role is anywhere in a merged category', () => {
    const teams = makeTeams(2)
    teams[0].players = [{ id: 'r1', name: 'R1', role: 'Wicket-keeper' }]
    setupDraftRoomWithOrder('RS04', makeConfig({ categoryGroups: [{ roles: ['Batsman', 'Wicket-keeper'] }] }), teams,
      makePlayers([{ role: 'Batsman', count: 2 }, { role: 'Wicket-keeper', count: 2 }]), ['team1', 'team2'])
    const started = engine.startDraft('RS04', io)
    const room = engine.getRoom('RS04')

    assert.equal(room.categorySkips.team1, 0) // 1 owed, already consumed resolving this turn
    assert.notEqual(started.currentTurnTeamId, 'team1')
  })

  it('undo restores categorySkips exactly, even across other teams skipped in between', () => {
    const teams = makeTeams(3)
    teams[0].players = [{ id: 'r1', name: 'R1', role: 'Batsman' }] // team1: 1 skip owed
    setupDraftRoom('RS05', makeConfig({ numTeams: 3 }), teams, makePlayers([{ role: 'Batsman', count: 4 }]))
    engine.startDraft('RS05', io) // team1 skipped (1 -> 0), someone else on turn
    const beforePick = { ...engine.getRoom('RS05').categorySkips }

    playCurrentTurn('RS05')
    const room = engine.getRoom('RS05')
    const lastPick = room.picks[room.picks.length - 1]
    assert.deepEqual(lastPick.categorySkips, beforePick)

    engine.undoPick('RS05', io)
    const undone = engine.getRoom('RS05')
    assert.deepEqual(undone.categorySkips, beforePick)
  })
})

// ─── randomizePickOrder — mid-draft (round boundary) ────────────

describe('randomizePickOrder — mid-draft (round boundary)', () => {
  it('rejects reshuffling mid-round (currentTurnIdx !== 0)', () => {
    setupDraftRoomWithOrder('RSH01', makeConfig({ numTeams: 3 }), makeTeams(3), makePlayers([{ role: 'Batsman', count: 4 }]), ['team1', 'team2', 'team3'])
    const started = engine.startDraft('RSH01', io)
    const player = engine.getRoom('RSH01').players.find(p => p.status === 'pending')
    engine.pickPlayer('RSH01', started.currentTurnTeamId, player.id, io) // currentTurnIdx now 1 — not a boundary

    const before = engine.getRoom('RSH01')
    const beforeOrder = [...before.pickOrder]
    const beforeIdx = before.currentTurnIdx

    const result = engine.randomizePickOrder('RSH01', io)

    assert.ok(result.error)
    const room = engine.getRoom('RSH01')
    assert.deepEqual(room.pickOrder, beforeOrder)
    assert.equal(room.currentTurnIdx, beforeIdx)
  })

  it('allows reshuffling once running and back at a round boundary', () => {
    setupDraftRoomWithOrder('RSH02', makeConfig(), makeTeams(2), makePlayers([{ role: 'Batsman', count: 4 }]), ['team1', 'team2'])
    const started = engine.startDraft('RSH02', io)
    const players = engine.getRoom('RSH02').players
    engine.pickPlayer('RSH02', started.currentTurnTeamId, players[0].id, io)
    const afterFirst = engine.getRoom('RSH02')
    const secondTurn = afterFirst.pickOrder[afterFirst.currentTurnIdx]
    engine.pickPlayer('RSH02', secondTurn, players[1].id, io) // full round complete — wraps to idx 0

    const boundary = engine.getRoom('RSH02')
    assert.equal(boundary.status, 'running')
    assert.equal(boundary.currentTurnIdx, 0)

    const result = engine.randomizePickOrder('RSH02', io)

    assert.equal(result.error, undefined)
    assert.deepEqual([...result.pickOrder].sort(), ['team1', 'team2'])
    assert.equal(result.currentTurnIdx, 0)
  })

  it('logs exactly one shuffle event on a mid-draft reshuffle, none for a pre-draft one', () => {
    createOnlyDraftRoom('RSH03', makeConfig(), makeTeams(2), makePlayers([{ role: 'Batsman', count: 4 }]))
    engine.randomizePickOrder('RSH03', io) // idle shuffle — should not log
    assert.deepEqual(engine.getRoom('RSH03').events, [])

    const started = engine.startDraft('RSH03', io)
    const players = engine.getRoom('RSH03').players
    engine.pickPlayer('RSH03', started.currentTurnTeamId, players[0].id, io)
    const secondTurn = engine.getRoom('RSH03').pickOrder[engine.getRoom('RSH03').currentTurnIdx]
    engine.pickPlayer('RSH03', secondTurn, players[1].id, io) // round wraps

    engine.randomizePickOrder('RSH03', io)
    const room = engine.getRoom('RSH03')
    assert.equal(room.events.length, 1)
    assert.equal(room.events[0].type, 'shuffle')
  })

  it('does not affect the undo stack', () => {
    setupDraftRoomWithOrder('RSH04', makeConfig(), makeTeams(2), makePlayers([{ role: 'Batsman', count: 4 }]), ['team1', 'team2'])
    const started = engine.startDraft('RSH04', io)
    const players = engine.getRoom('RSH04').players
    engine.pickPlayer('RSH04', started.currentTurnTeamId, players[0].id, io)
    const secondTurn = engine.getRoom('RSH04').pickOrder[engine.getRoom('RSH04').currentTurnIdx]
    engine.pickPlayer('RSH04', secondTurn, players[1].id, io)

    const picksBefore = engine.getRoom('RSH04').picks.length
    engine.randomizePickOrder('RSH04', io)
    assert.equal(engine.getRoom('RSH04').picks.length, picksBefore)
  })

  it('re-validates the newly-shuffled front team against skip rules', () => {
    // team1 retains a Wicket-keeper — owes 1 skip once the Wicket-keeper
    // category comes up, but hasn't been evaluated against it yet.
    const teams = makeTeams(2)
    teams[0].players = [{ id: 'r1', name: 'R1', role: 'Wicket-keeper' }]
    setupDraftRoomWithOrder(
      'RSH05',
      makeConfig({ categoryGroups: [{ roles: ['Batsman'] }, { roles: ['Wicket-keeper'] }] }),
      teams,
      makePlayers([{ role: 'Batsman', count: 2 }, { role: 'Wicket-keeper', count: 2 }]),
      ['team1', 'team2']
    )
    const started = engine.startDraft('RSH05', io) // 0 retained Batsman — no skip, team1 leads
    assert.equal(started.currentTurnTeamId, 'team1')

    const batsman1 = engine.getRoom('RSH05').players.find(p => p.role === 'Batsman')
    engine.pickPlayer('RSH05', 'team1', batsman1.id, io)
    const batsman2 = engine.getRoom('RSH05').players.find(p => p.status === 'pending' && p.role === 'Batsman')
    engine.pickPlayer('RSH05', 'team2', batsman2.id, io) // Batsman exhausted -> Wicket-keeper, round wraps

    const boundary = engine.getRoom('RSH05')
    assert.equal(boundary.currentCategoryIdx, 1)
    assert.equal(boundary.currentTurnIdx, 0)
    assert.equal(boundary.pickOrder[boundary.currentTurnIdx], 'team2') // team2 evaluated first, owes nothing

    // Whichever way the shuffle lands team1 or team2 up front, team1's
    // still-unconsumed Wicket-keeper skip must keep team2 on the clock.
    const result = engine.randomizePickOrder('RSH05', io)
    assert.equal(result.error, undefined)
    assert.equal(result.currentTurnTeamId, 'team2')
  })

  it('events survive a serializeRoom -> hydrateRoom round trip', () => {
    setupDraftRoomWithOrder('RSH06', makeConfig(), makeTeams(2), makePlayers([{ role: 'Batsman', count: 4 }]), ['team1', 'team2'])
    const started = engine.startDraft('RSH06', io)
    const players = engine.getRoom('RSH06').players
    engine.pickPlayer('RSH06', started.currentTurnTeamId, players[0].id, io)
    const secondTurn = engine.getRoom('RSH06').pickOrder[engine.getRoom('RSH06').currentTurnIdx]
    engine.pickPlayer('RSH06', secondTurn, players[1].id, io)
    engine.randomizePickOrder('RSH06', io)

    const room = engine.getRoom('RSH06')
    assert.equal(room.events.length, 1)

    const serialized = engine.serializeRoom(room)
    assert.equal(serialized.events.length, 1)

    const rehydrated = engine.hydrateRoom('RSH06_HYDRATED', serialized)
    assert.equal(rehydrated.events.length, 1)
    assert.equal(rehydrated.events[0].type, 'shuffle')
  })
})
