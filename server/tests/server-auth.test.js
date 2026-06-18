'use strict'

const { describe, it, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const engine = require('../auction-engine')
const { httpServer, validateCaptainSession, _test } = require('../index')

let baseUrl = ''
let roomCounter = 0

function nextRoomCode(prefix = 'T') {
  roomCounter += 1
  return `${prefix}${Date.now().toString(36)}${roomCounter}`.toUpperCase().slice(0, 10)
}

function makeAuctionData() {
  return {
    config: {
      numTeams: 2,
      pointsPerTeam: 1000,
      maxPlayersPerTeam: 3,
      bidTiers: [{ upTo: null, increment: 10 }],
      timerEnabled: false,
      timerSeconds: 30,
      minBidBase: 10,
      randomizeOrder: false,
    },
    teams: [
      { id: 'team1', name: 'Team 1', pin: '1111', budget: 1000, spent: 0, players: [] },
      { id: 'team2', name: 'Team 2', pin: '2222', budget: 1000, spent: 0, players: [] },
    ],
    players: [
      { id: 'p1', name: 'Player 1', role: 'Batsman', basePrice: 100, status: 'pending', soldTo: null, soldPrice: null },
    ],
  }
}

async function postJson(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  return { status: res.status, body: json }
}

describe('server auth flows', () => {
  before(async () => {
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    const addr = httpServer.address()
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  after(async () => {
    await new Promise((resolve) => httpServer.close(resolve))
  })

  beforeEach(() => {
    _test.resetServerStateForTests()
  })

  it('issues captainToken after successful captain join REST validation', async () => {
    const roomCode = nextRoomCode('J')
    const auctionData = makeAuctionData()

    const created = await postJson('/api/auction/create', { roomCode, auctionData })
    assert.equal(created.status, 200)
    assert.equal(created.body.ok, true)

    const joined = await postJson(`/api/auction/${roomCode}/join`, { pin: '1111' })
    assert.equal(joined.status, 200)
    assert.equal(joined.body.teamId, 'team1')
    assert.equal(typeof joined.body.captainToken, 'string')
    assert.ok(joined.body.captainToken.length >= 20)
  })

  it('rejects restore when admin token is missing or invalid', async () => {
    const roomCode = nextRoomCode('R')
    const auctionData = makeAuctionData()

    const created = await postJson('/api/auction/create', { roomCode, auctionData })
    assert.equal(created.status, 200)
    const adminToken = created.body.adminToken

    const snapshot = {
      config: auctionData.config,
      teams: auctionData.teams,
      players: auctionData.players,
      queue: [0],
      currentIdx: -1,
      currentPrice: null,
      leadingTeamId: null,
      bids: [],
      status: 'idle',
      secondRound: false,
    }

    const missingToken = await postJson('/api/auction/restore', {
      roomCode,
      snapshot,
      originalSetup: auctionData,
    })
    assert.equal(missingToken.status, 401)
    assert.equal(missingToken.body.error, 'Invalid admin token')

    const badToken = await postJson('/api/auction/restore', {
      roomCode,
      snapshot,
      originalSetup: auctionData,
      adminToken: 'wrong-token',
    })
    assert.equal(badToken.status, 401)
    assert.equal(badToken.body.error, 'Invalid admin token')

    const goodToken = await postJson('/api/auction/restore', {
      roomCode,
      snapshot,
      originalSetup: auctionData,
      adminToken,
    })
    assert.equal(goodToken.status, 200)
    assert.equal(goodToken.body.ok, true)
  })

  it('rejects restore when using another room\'s admin token', async () => {
    const roomA = nextRoomCode('A')
    const roomB = nextRoomCode('B')
    const auctionDataA = makeAuctionData()
    const auctionDataB = makeAuctionData()

    const createdA = await postJson('/api/auction/create', { roomCode: roomA, auctionData: auctionDataA })
    const createdB = await postJson('/api/auction/create', { roomCode: roomB, auctionData: auctionDataB })
    assert.equal(createdA.status, 200)
    assert.equal(createdB.status, 200)

    const tokenA = createdA.body.adminToken
    assert.equal(typeof tokenA, 'string')

    const snapshotB = {
      config: auctionDataB.config,
      teams: auctionDataB.teams,
      players: auctionDataB.players,
      queue: [0],
      currentIdx: -1,
      currentPrice: null,
      leadingTeamId: null,
      bids: [],
      status: 'idle',
      secondRound: false,
    }

    const crossRoomRestore = await postJson('/api/auction/restore', {
      roomCode: roomB,
      snapshot: snapshotB,
      originalSetup: auctionDataB,
      adminToken: tokenA,
    })

    assert.equal(crossRoomRestore.status, 401)
    assert.equal(crossRoomRestore.body.error, 'Invalid admin token')
  })

  it('validates captain session token and team binding', async () => {
    const roomCode = nextRoomCode('S')
    const auctionData = makeAuctionData()

    const created = await postJson('/api/auction/create', { roomCode, auctionData })
    assert.equal(created.status, 200)

    const joined = await postJson(`/api/auction/${roomCode}/join`, { pin: '1111' })
    assert.equal(joined.status, 200)

    const room = engine.getRoom(roomCode)
    assert.ok(room)

    const validErr = validateCaptainSession(room, roomCode, 'team1', joined.body.captainToken)
    assert.equal(validErr, null)

    const badTokenErr = validateCaptainSession(room, roomCode, 'team1', 'invalid-token')
    assert.equal(badTokenErr, 'Invalid captain session. Please rejoin with PIN.')

    const badTeamErr = validateCaptainSession(room, roomCode, 'team999', joined.body.captainToken)
    assert.equal(badTeamErr, 'Invalid team for this room.')
  })
})
