/**
 * Auction Engine — server-side bid processing for online mode.
 * Handles one active auction per room. All bid operations are
 * synchronous within the JS event loop, making them race-condition safe.
 */

// rooms: Map<roomCode, AuctionRoom>
const rooms = new Map()

function makeRoom(config) {
  return {
    config,           // { numTeams, pointsPerTeam, bidIncrement, timerEnabled, timerSeconds, minBidBase }
    teams: [],        // [{ id, name, pin, budget, spent, players: [] }]
    players: [],      // [{ id, name, role, basePrice, status, soldTo, soldPrice }]
    queue: [],        // indices into players[]
    currentIdx: -1,
    currentPrice: null,
    leadingTeamId: null,
    bids: [],         // [{ teamId, price, ts }]
    status: 'idle',   // idle | running | sold | unsold | finished
    timerLeft: null,
    timerHandle: null,
    secondRound: false,
    connectedCaptains: new Map(), // socketId -> teamId
  }
}

// ── Public API ────────────────────────────────────────────────

function createRoom(roomCode, auctionData) {
  const room = makeRoom(auctionData.config)
  room.teams = auctionData.teams.map(t => ({ ...t, budget: auctionData.config.pointsPerTeam, spent: 0, players: [] }))
  room.players = auctionData.players.map(p => ({ ...p, status: 'pending', soldTo: null, soldPrice: null }))
  room.queue = room.players.map((_, i) => i)
  rooms.set(roomCode, room)
  return room
}

function getRoom(roomCode) {
  return rooms.get(roomCode) || null
}

function joinRoom(roomCode, pin) {
  const room = getRoom(roomCode)
  if (!room) return { error: 'Room not found' }
  const team = room.teams.find(t => t.pin === pin)
  if (!team) return { error: 'Invalid PIN' }
  return { team, room }
}

function connectCaptain(roomCode, teamId, socketId) {
  const room = getRoom(roomCode)
  if (!room) return
  room.connectedCaptains.set(socketId, teamId)
}

function disconnectCaptain(roomCode, socketId) {
  const room = getRoom(roomCode)
  if (!room) return
  room.connectedCaptains.delete(socketId)
}

function startNextPlayer(roomCode, io) {
  const room = getRoom(roomCode)
  if (!room) return { error: 'Room not found' }

  const nextIdx = room.currentIdx + 1
  if (nextIdx >= room.queue.length) {
    // Queue exhausted — auto-requeue unsold players if first round
    if (!room.secondRound) {
      const unsoldIdxs = room.players.reduce((acc, p, i) =>
        p.status === 'unsold' ? [...acc, i] : acc, [])
      if (unsoldIdxs.length > 0) {
        clearTimer(room)
        unsoldIdxs.forEach(i => { room.players[i] = { ...room.players[i], status: 'pending' } })
        room.queue = unsoldIdxs
        room.currentIdx = 0
        room.secondRound = true
        const playerIdx = unsoldIdxs[0]
        room.currentPrice = room.players[playerIdx].basePrice
        room.leadingTeamId = null
        room.bids = []
        room.status = 'running'
        room.timerLeft = room.config.timerEnabled ? room.config.timerSeconds : null
        io.to(roomCode).emit('auction:secondRound', publicState(room))
        if (room.config.timerEnabled) startTimer(roomCode, room, io)
        return publicState(room)
      }
    }
    clearTimer(room)
    room.status = 'finished'
    io.to(roomCode).emit('auction:finished', publicState(room))
    return { status: 'finished' }
  }

  clearTimer(room)
  room.currentIdx = nextIdx
  const playerIdx = room.queue[nextIdx]
  room.currentPrice = room.players[playerIdx].basePrice
  room.leadingTeamId = null
  room.bids = []
  room.status = 'running'
  room.timerLeft = room.config.timerEnabled ? room.config.timerSeconds : null

  io.to(roomCode).emit('auction:playerStart', publicState(room))

  if (room.config.timerEnabled) startTimer(roomCode, room, io)

  return publicState(room)
}

function placeBid(roomCode, teamId, io) {
  const room = getRoom(roomCode)
  if (!room) return { error: 'Room not found' }
  if (room.status !== 'running') return { error: 'Auction not running' }

  const team = room.teams.find(t => t.id === teamId)
  if (!team) return { error: 'Team not found' }

  const newPrice = room.currentPrice + room.config.bidIncrement
  if (room.leadingTeamId === teamId) return { error: 'Already leading' }
  if (team.budget < newPrice) return { error: 'Insufficient budget' }

  room.currentPrice = newPrice
  room.leadingTeamId = teamId
  room.bids.unshift({ teamId, price: newPrice, ts: Date.now() })

  // Reset timer on new bid
  if (room.config.timerEnabled) {
    room.timerLeft = room.config.timerSeconds
    clearTimer(room)
    startTimer(roomCode, room, io)
  }

  io.to(roomCode).emit('bid:accepted', {
    teamId,
    price: newPrice,
    teamName: team.name,
    timerLeft: room.timerLeft,
  })

  return { ok: true }
}

function sellPlayer(roomCode, io) {
  const room = getRoom(roomCode)
  if (!room || !room.leadingTeamId) return { error: 'No leading bid' }
  clearTimer(room)

  const playerIdx = room.queue[room.currentIdx]
  const team = room.teams.find(t => t.id === room.leadingTeamId)
  team.budget -= room.currentPrice
  team.spent = (team.spent || 0) + room.currentPrice
  team.players.push({ ...room.players[playerIdx], soldPrice: room.currentPrice })

  room.players[playerIdx] = { ...room.players[playerIdx], status: 'sold', soldTo: room.leadingTeamId, soldPrice: room.currentPrice }
  room.status = 'sold'

  io.to(roomCode).emit('auction:sold', publicState(room))
  return publicState(room)
}

function undoBid(roomCode, io) {
  const room = getRoom(roomCode)
  if (!room) return { error: 'Room not found' }
  if (room.status !== 'running') return { error: 'Auction not running' }
  if (!room.bids.length) return { error: 'No bids to undo' }

  room.bids.shift() // remove most recent bid
  const playerIdx = room.queue[room.currentIdx]
  const basePrice = room.players[playerIdx].basePrice
  room.currentPrice = room.bids.length > 0 ? room.bids[0].price : basePrice
  room.leadingTeamId = room.bids.length > 0 ? room.bids[0].teamId : null

  // Reset timer
  if (room.config.timerEnabled) {
    clearTimer(room)
    room.timerLeft = room.config.timerSeconds
    startTimer(roomCode, room, io)
  }

  io.to(roomCode).emit('auction:stateUpdate', publicState(room))
  return publicState(room)
}

function unsellPlayer(roomCode, io) {
  const room = getRoom(roomCode)
  if (!room) return { error: 'Room not found' }
  clearTimer(room)

  const playerIdx = room.queue[room.currentIdx]
  room.players[playerIdx] = { ...room.players[playerIdx], status: 'unsold' }
  room.status = 'unsold'

  io.to(roomCode).emit('auction:unsold', publicState(room))
  return publicState(room)
}

function finishAuction(roomCode, io) {
  const room = getRoom(roomCode)
  if (!room) return { error: 'Room not found' }
  clearTimer(room)
  room.status = 'finished'
  io.to(roomCode).emit('auction:finished', publicState(room))
  return publicState(room)
}

function requeueUnsold(roomCode, io) {
  const room = getRoom(roomCode)
  if (!room) return { error: 'Room not found' }

  const unsoldIdxs = room.players.reduce((acc, p, i) => p.status === 'unsold' ? [...acc, i] : acc, [])
  if (!unsoldIdxs.length) return { error: 'No unsold players' }

  room.players.forEach((p, i) => { if (p.status === 'unsold') room.players[i] = { ...p, status: 'pending' } })
  const remainingQueue = room.queue.slice(room.currentIdx + 1)
  room.queue = [...remainingQueue, ...unsoldIdxs]
  room.currentIdx = -1
  room.status = 'idle'

  io.to(roomCode).emit('auction:stateUpdate', publicState(room))
  return publicState(room)
}

// ── Helpers ───────────────────────────────────────────────────

function startTimer(roomCode, room, io) {
  room.timerHandle = setInterval(() => {
    room.timerLeft -= 1
    io.to(roomCode).emit('timer:tick', { timerLeft: room.timerLeft })

    if (room.timerLeft <= 0) {
      clearTimer(room)
      if (room.leadingTeamId) sellPlayer(roomCode, io)
      else unsellPlayer(roomCode, io)
    }
  }, 1000)
}

function clearTimer(room) {
  if (room.timerHandle) {
    clearInterval(room.timerHandle)
    room.timerHandle = null
  }
}

function publicState(room) {
  return {
    config: room.config,
    teams: room.teams.map(({ pin: _pin, ...t }) => t), // strip PINs from broadcast
    players: room.players,
    queue: room.queue,
    currentIdx: room.currentIdx,
    currentPrice: room.currentPrice,
    leadingTeamId: room.leadingTeamId,
    bids: room.bids.slice(0, 50),
    status: room.status,
    timerLeft: room.timerLeft,
    secondRound: room.secondRound,
    connectedTeamIds: [...room.connectedCaptains.values()],
  }
}

module.exports = {
  createRoom,
  getRoom,
  joinRoom,
  connectCaptain,
  disconnectCaptain,
  startNextPlayer,
  placeBid,
  undoBid,
  sellPlayer,
  unsellPlayer,
  finishAuction,
  requeueUnsold,
  publicState,
}
