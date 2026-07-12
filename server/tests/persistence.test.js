'use strict'
const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')

const engine = require('../auction-engine')
const persistence = require('../persistence')

const io = { to: () => ({ emit: () => {} }) }

function makeConfig(o = {}) {
  return { numTeams: 2, pointsPerTeam: 1000, maxPlayersPerTeam: 3, bidTiers: [{ upTo: null, increment: 100 }], timerEnabled: false, timerSeconds: 30, ...o }
}
function makeTeams(n = 2, budget = 1000) {
  return Array.from({ length: n }, (_, i) => ({ id: `team${i + 1}`, name: `Team ${i + 1}`, pin: `100${i + 1}`, budget, spent: 0, players: [] }))
}
function makePlayers(prices) {
  return prices.map((bp, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, role: 'Batsman', basePrice: bp, status: 'pending' }))
}

describe('persistence', () => {
  after(() => { try { fs.rmSync(persistence.DATA_DIR, { recursive: true, force: true }) } catch { /* ignore */ } })

  it('saves rooms + tokens to disk and restores them; running rooms come back paused', () => {
    const adminTokens = new Map([['PST1', 'tok-abc']])
    const captainTokens = new Map([['PST1', new Map([['team1', 'ctok']])]])

    engine.createRoom('PST1', { config: makeConfig(), teams: makeTeams(2, 1000), players: makePlayers([100, 200]) })
    engine.startNextPlayer('PST1', io) // status → running

    assert.equal(persistence.saveState({ adminTokens, captainTokens }), true)

    const data = persistence.loadState()
    assert.ok(data && data.rooms && data.rooms.PST1)
    assert.equal(data.rooms.PST1.status, 'running')
    assert.equal(data.rooms.PST1.players.length, 2)

    // Simulate a fresh boot restoring into empty token maps.
    const newAdmin = new Map()
    const newCaptain = new Map()
    const restored = persistence.restoreState({ adminTokens: newAdmin, captainTokens: newCaptain })
    assert.ok(restored >= 1)
    assert.equal(newAdmin.get('PST1'), 'tok-abc')
    assert.equal(newCaptain.get('PST1').get('team1'), 'ctok')

    // A room that was running comes back paused (countdown shouldn't run headless).
    const room = engine.getRoom('PST1')
    assert.equal(room.status, 'running')
    assert.equal(room.paused, true)
  })
})
