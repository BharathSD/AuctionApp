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

  it('rejects once the draft has started', () => {
    setupDraftRoom('DRP02', makeConfig(), makeTeams(), makePlayers([{ role: 'Batsman', count: 1 }]))
    engine.startDraft('DRP02', io)
    const result = engine.randomizePickOrder('DRP02', io)
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
