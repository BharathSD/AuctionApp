'use strict'

const { describe, it, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { io: ioClient } = require('socket.io-client')

const { httpServer, _test } = require('../index')
const engine = require('../auction-engine')

let baseUrl = ''
let roomCounter = 0

function nextRoomCode(prefix = 'W') {
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

async function setupRoomAndCaptain({ roomPrefix = 'W', pin = '1111' } = {}) {
  const roomCode = nextRoomCode(roomPrefix)
  const auctionData = makeAuctionData()
  const created = await postJson('/api/auction/create', { roomCode, auctionData })
  assert.equal(created.status, 200)

  const joined = await postJson(`/api/auction/${roomCode}/join`, { pin })
  assert.equal(joined.status, 200)
  return { roomCode, auctionData, joined }
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

describe('socket captain auth', () => {
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

  it('allows captain socket join with valid captainToken', async () => {
    const { roomCode, joined } = await setupRoomAndCaptain({ roomPrefix: 'V' })
    assert.equal(typeof joined.body.captainToken, 'string')

    const socket = await connectSocket()
    try {
      const stateUpdatePromise = waitForEvent(socket, 'auction:stateUpdate')
      socket.emit('captain:join', {
        roomCode,
        teamId: joined.body.teamId,
        captainToken: joined.body.captainToken,
      })
      const state = await stateUpdatePromise
      assert.equal(Array.isArray(state.teams), true)
      assert.equal(state.teams.length, 2)
    } finally {
      socket.disconnect()
    }
  })

  it('rejects captain socket join with invalid captainToken', async () => {
    const { roomCode, joined } = await setupRoomAndCaptain({ roomPrefix: 'X' })

    const socket = await connectSocket()
    try {
      const rejectedPromise = waitForEvent(socket, 'session:rejected')
      socket.emit('captain:join', {
        roomCode,
        teamId: joined.body.teamId,
        captainToken: `${joined.body.captainToken}-tampered`,
      })
      const rej = await rejectedPromise
      assert.equal(rej.reason, 'Invalid captain session. Please rejoin with PIN.')
    } finally {
      socket.disconnect()
    }
  })

  it('rejects captain socket join with invalid team for room', async () => {
    const { roomCode, joined } = await setupRoomAndCaptain({ roomPrefix: 'Y' })

    const socket = await connectSocket()
    try {
      const rejectedPromise = waitForEvent(socket, 'session:rejected')
      socket.emit('captain:join', {
        roomCode,
        teamId: 'team999',
        captainToken: joined.body.captainToken,
      })
      const rej = await rejectedPromise
      assert.equal(rej.reason, 'Invalid team for this room.')
    } finally {
      socket.disconnect()
    }
  })

  it('rejects second simultaneous captain connection for same team', async () => {
    const { roomCode, joined } = await setupRoomAndCaptain({ roomPrefix: 'Z' })

    const socket1 = await connectSocket()
    const socket2 = await connectSocket()
    try {
      const stateUpdatePromise = waitForEvent(socket1, 'auction:stateUpdate')
      socket1.emit('captain:join', {
        roomCode,
        teamId: joined.body.teamId,
        captainToken: joined.body.captainToken,
      })
      await stateUpdatePromise

      const rejectedPromise = waitForEvent(socket2, 'session:rejected')
      socket2.emit('captain:join', {
        roomCode,
        teamId: joined.body.teamId,
        captainToken: joined.body.captainToken,
      })
      const rej = await rejectedPromise
      assert.equal(rej.reason, 'This team is already connected from another device.')
    } finally {
      socket1.disconnect()
      socket2.disconnect()
    }
  })

  it('allows reconnect within grace period after disconnect', async () => {
    const { roomCode, joined } = await setupRoomAndCaptain({ roomPrefix: 'G' })

    const socket1 = await connectSocket()
    try {
      const stateUpdatePromise = waitForEvent(socket1, 'auction:stateUpdate')
      socket1.emit('captain:join', {
        roomCode,
        teamId: joined.body.teamId,
        captainToken: joined.body.captainToken,
      })
      await stateUpdatePromise
    } finally {
      socket1.disconnect()
    }

    const socket2 = await connectSocket()
    try {
      const stateUpdatePromise = waitForEvent(socket2, 'auction:stateUpdate')
      socket2.emit('captain:join', {
        roomCode,
        teamId: joined.body.teamId,
        captainToken: joined.body.captainToken,
      })
      const state = await stateUpdatePromise
      assert.equal(Array.isArray(state.teams), true)
      assert.equal(state.teams.length, 2)
    } finally {
      socket2.disconnect()
    }
  })

  it('enforces bid rate limit per team across reconnects', async () => {
    const { roomCode, joined } = await setupRoomAndCaptain({ roomPrefix: 'RL' })
    const room = engine.getRoom(roomCode)
    assert.ok(room)
    room.config.maxPlayersPerTeam = 0
    room.config.bidTiers = [{ upTo: null, increment: 0 }]
    room.config.timerEnabled = false

    engine.startNextPlayer(roomCode, { to: () => ({ emit: () => {} }) })

    const originalNow = Date.now
    const fixedNow = originalNow()
    Date.now = () => fixedNow

    try {
      const socket1 = await connectSocket()
      try {
        const stateUpdatePromise = waitForEvent(socket1, 'auction:stateUpdate')
        socket1.emit('captain:join', {
          roomCode,
          teamId: joined.body.teamId,
          captainToken: joined.body.captainToken,
        })
        await stateUpdatePromise

        const acceptedPromise = waitForEvent(socket1, 'bid:accepted')
        socket1.emit('captain:bid')
        await acceptedPromise

        const rejectedPromise = waitForEvent(socket1, 'bid:rejected')
        socket1.emit('captain:bid')
        const rej = await rejectedPromise
        assert.ok(typeof rej.reason === 'string' && rej.reason.length > 0)
      } finally {
        socket1.disconnect()
      }

      const socket2 = await connectSocket()
      try {
        const stateUpdatePromise = waitForEvent(socket2, 'auction:stateUpdate')
        socket2.emit('captain:join', {
          roomCode,
          teamId: joined.body.teamId,
          captainToken: joined.body.captainToken,
        })
        await stateUpdatePromise

        const rejectedPromise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            socket2.off('bid:rejected', onRejected)
            reject(new Error('Timed out waiting for rate-limit rejection'))
          }, 2500)

          function onRejected(rej) {
            if (rej?.reason === 'Bid rate limit exceeded. Wait before bidding again.') {
              clearTimeout(timer)
              socket2.off('bid:rejected', onRejected)
              resolve(rej)
            }
          }

          socket2.on('bid:rejected', onRejected)
        })

        for (let i = 0; i < 2; i++) socket2.emit('captain:bid')
        const rej = await rejectedPromise
        assert.equal(rej.reason, 'Bid rate limit exceeded. Wait before bidding again.')
      } finally {
        socket2.disconnect()
      }
    } finally {
      Date.now = originalNow
    }
  })
})
