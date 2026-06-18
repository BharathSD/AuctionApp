'use strict'

const { describe, it, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { io: ioClient } = require('socket.io-client')

const engine = require('../auction-engine')
const { httpServer, _test } = require('../index')

let baseUrl = ''
let roomCounter = 0

function nextRoomCode(prefix = 'AD') {
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

function waitForEvent(socket, event, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent)
      reject(new Error(`Timed out waiting for event: ${event}`))
    }, timeoutMs)

    function onEvent(data) {
      clearTimeout(timer)
      socket.off(event, onEvent)
      resolve(data)
    }

    socket.on(event, onEvent)
  })
}

function connectSocket() {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      timeout: 2500,
    })

    const timer = setTimeout(() => {
      socket.disconnect()
      reject(new Error('Timed out waiting for socket connection'))
    }, 3000)

    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })

    socket.once('connect_error', (err) => {
      clearTimeout(timer)
      socket.disconnect()
      reject(err)
    })
  })
}

async function setupRoom(roomPrefix = 'AD') {
  const roomCode = nextRoomCode(roomPrefix)
  const auctionData = makeAuctionData()
  const created = await postJson('/api/auction/create', { roomCode, auctionData })
  assert.equal(created.status, 200)
  assert.equal(typeof created.body.adminToken, 'string')
  return { roomCode, auctionData, adminToken: created.body.adminToken }
}

describe('socket admin auth', () => {
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

  it('rejects admin socket join with invalid admin token', async () => {
    const { roomCode } = await setupRoom('AI')

    const socket = await connectSocket()
    try {
      const errorPromise = waitForEvent(socket, 'error')
      socket.emit('admin:join', { roomCode, adminToken: 'bad-token' })
      const err = await errorPromise
      assert.equal(err.message, 'Invalid admin token')
    } finally {
      socket.disconnect()
    }
  })

  it('allows admin socket join with valid admin token and sends state', async () => {
    const { roomCode, adminToken } = await setupRoom('AV')

    const socket = await connectSocket()
    try {
      const statePromise = waitForEvent(socket, 'auction:stateUpdate')
      socket.emit('admin:join', { roomCode, adminToken })
      const state = await statePromise
      assert.equal(state.status, 'idle')
      assert.equal(Array.isArray(state.teams), true)
      assert.equal(Array.isArray(state.players), true)
      assert.equal(state.players.length, 1)
    } finally {
      socket.disconnect()
    }
  })

  it('rejects admin token reuse across rooms', async () => {
    const roomA = await setupRoom('A1')
    const roomB = await setupRoom('B1')

    const socket = await connectSocket()
    try {
      const errorPromise = waitForEvent(socket, 'error')
      socket.emit('admin:join', { roomCode: roomB.roomCode, adminToken: roomA.adminToken })
      const err = await errorPromise
      assert.equal(err.message, 'Invalid admin token')
    } finally {
      socket.disconnect()
    }
  })

  it('ignores admin control events from non-admin sockets', async () => {
    const { roomCode } = await setupRoom('AN')
    const room = engine.getRoom(roomCode)
    assert.ok(room)
    assert.equal(room.status, 'idle')
    assert.equal(room.currentIdx, -1)

    const socket = await connectSocket()
    try {
      const statePromise = waitForEvent(socket, 'auction:stateUpdate')
      socket.emit('viewer:join', { roomCode })
      await statePromise

      socket.emit('admin:nextPlayer')
      socket.emit('admin:finish')
      await new Promise(resolve => setTimeout(resolve, 25))

      const after = engine.getRoom(roomCode)
      assert.equal(after.status, 'idle')
      assert.equal(after.currentIdx, -1)
      assert.equal(after.currentPrice, null)
    } finally {
      socket.disconnect()
    }
  })
})
