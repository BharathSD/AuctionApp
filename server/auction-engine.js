/**
 * Auction Engine — server-side bid processing for online mode.
 * Handles one active auction per room. All bid operations are
 * synchronous within the JS event loop, making them race-condition safe.
 */

// rooms: Map<roomCode, AuctionRoom>
const rooms = new Map()

// Returns the bid increment for the given current price based on staged tiers.
// Backward compat: falls back to flat config.bidIncrement if bidTiers absent.
function getIncrement(currentPrice, config) {
  const tiers = config.bidTiers
  if (!tiers || tiers.length === 0) return Number(config.bidIncrement) || 0
  const tier = tiers.find(t => t.upTo === null || t.upTo === undefined || currentPrice < Number(t.upTo))
  return Number(tier?.increment ?? tiers[tiers.length - 1].increment ?? 0)
}

// Returns the minimum budget needed to fill `spotsNeeded` more roster spots
// using the cheapest still-available (pending/unsold) players' base prices,
// excluding the player currently on the block (by array index).
function minCostForRemainingSpots(players, excludeIdx, spotsNeeded) {
  if (spotsNeeded <= 0) return 0
  const prices = players
    .filter((p, i) => i !== excludeIdx && (p.status === 'pending' || p.status === 'unsold'))
    .map(p => Number(p.basePrice) || 0)
    .sort((a, b) => a - b)
  return prices.slice(0, spotsNeeded).reduce((sum, v) => sum + v, 0)
}

function makeRoom(config) {
  return {
    config,           // { numTeams, pointsPerTeam, bidTiers, timerEnabled, timerSeconds, minBidBase }
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
    paused: false,
    soldHistory: [],    // stack of sold actions for undo
    connectedCaptains: new Map(), // socketId -> teamId
    // Session tracking: teamId -> { socketId, disconnectedAt (ms) | null }
    captainSessions: new Map(),
    gracePeriodHandles: new Map(), // teamId -> setTimeout handle
  }
}

// ── Public API ────────────────────────────────────────────────

function createRoom(roomCode, auctionData) {
  const room = makeRoom(auctionData.config)
  // Preserve team budgets/rosters from setup (pre-allocations already applied)
  room.teams = auctionData.teams.map(t => ({ ...t }))
  // Preserve player statuses — pre-allocated players are already 'sold'
  room.players = auctionData.players.map(p => ({ ...p }))
  // Queue only contains pending (not pre-allocated) players
  room.queue = room.players.reduce((acc, p, i) => p.status === 'pending' ? [...acc, i] : acc, [])
  if (room.config.randomizeOrder) {
    for (let i = room.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));[room.queue[i], room.queue[j]] = [room.queue[j], room.queue[i]]
    }
  }
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

function connectCaptain(roomCode, teamId, socketId, io) {
  const room = getRoom(roomCode)
  if (!room) return
  room.connectedCaptains.set(socketId, teamId)
  // Clear any pending grace timer
  if (room.gracePeriodHandles.has(teamId)) {
    clearTimeout(room.gracePeriodHandles.get(teamId))
    room.gracePeriodHandles.delete(teamId)
  }
  room.captainSessions.set(teamId, { socketId, disconnectedAt: null })
}

function disconnectCaptain(roomCode, socketId, io) {
  const room = getRoom(roomCode)
  if (!room) return
  const teamId = room.connectedCaptains.get(socketId)
  room.connectedCaptains.delete(socketId)
  if (!teamId) return
  // Start grace period — keep session alive for 10s for reconnects
  room.captainSessions.set(teamId, { socketId: null, disconnectedAt: Date.now() })
  const handle = setTimeout(() => {
    const session = room.captainSessions.get(teamId)
    if (session && session.socketId === null) {
      room.captainSessions.delete(teamId)
    }
    room.gracePeriodHandles.delete(teamId)
  }, 10000)
  room.gracePeriodHandles.set(teamId, handle)
}

// Returns null if allowed, or an error string if rejected
function checkCaptainJoin(roomCode, teamId) {
  const room = getRoom(roomCode)
  if (!room) return 'Room not found'
  const session = room.captainSessions.get(teamId)
  if (!session) return null // first join, allowed
  if (session.socketId !== null) return 'already_connected' // active connection exists
  // In grace period — allow reconnect
  return null
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
  if (room.paused) return { error: 'Auction is paused' }

  const team = room.teams.find(t => t.id === teamId)
  if (!team) return { error: 'Team not found' }

  const maxPlayers = Number(room.config.maxPlayersPerTeam) || 0
  if (maxPlayers > 0 && team.players.length >= maxPlayers) return { error: 'Team roster is full' }

  const newPrice = room.bids.length === 0
    ? room.currentPrice
    : room.currentPrice + getIncrement(room.currentPrice, room.config)
  if (room.leadingTeamId === teamId) return { error: 'Already leading' }
  if (team.budget < newPrice) return { error: 'Insufficient budget' }

  // Ensure the team can still afford to fill its remaining roster spots
  // using the cheapest available players after winning this one.
  if (maxPlayers > 0) {
    const currentPlayerIdx = room.queue[room.currentIdx]
    const spotsFilledAfter = team.players.length + 1
    const spotsNeededAfter = Math.max(0, maxPlayers - spotsFilledAfter)
    const minNeeded = minCostForRemainingSpots(room.players, currentPlayerIdx, spotsNeededAfter)
    if (team.budget - newPrice < minNeeded) return { error: 'Insufficient budget to fill remaining roster' }
  }

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
  const playerBefore = { ...room.players[playerIdx] }
  const team = room.teams.find(t => t.id === room.leadingTeamId)
  const soldAt = Date.now()

  room.soldHistory.push({
    playerIdx,
    playerId: room.players[playerIdx].id,
    teamId: room.leadingTeamId,
    soldPrice: room.currentPrice,
    currentIdx: room.currentIdx,
    playerBefore,
  })

  team.budget -= room.currentPrice
  team.spent = (team.spent || 0) + room.currentPrice
  team.players.push({ ...room.players[playerIdx], soldPrice: room.currentPrice, soldAt })

  room.players[playerIdx] = { ...room.players[playerIdx], status: 'sold', soldTo: room.leadingTeamId, soldPrice: room.currentPrice, soldAt }
  room.status = 'sold'

  // Auto-finish if all teams have full rosters
  const maxPlayers = Number(room.config.maxPlayersPerTeam) || 0
  if (maxPlayers > 0 && room.teams.every(t => t.players.length >= maxPlayers)) {
    room.status = 'finished'
    io.to(roomCode).emit('auction:finished', publicState(room))
    return publicState(room)
  }

  io.to(roomCode).emit('auction:sold', publicState(room))
  return publicState(room)
}

function undoSoldPlayer(roomCode, io) {
  const room = getRoom(roomCode)
  if (!room) return { error: 'Room not found' }
  if (!room.soldHistory.length) return { error: 'No sold player to undo' }

  clearTimer(room)
  const lastSold = room.soldHistory.pop()
  const team = room.teams.find(t => t.id === lastSold.teamId)
  if (!team) return { error: 'Winning team not found' }

  // Remove the most recently awarded player from that team roster.
  if (team.players.length > 0) {
    const lastIdx = team.players.length - 1
    if (team.players[lastIdx]?.id === lastSold.playerId) {
      team.players.pop()
    } else {
      const fallbackIdx = team.players.findLastIndex(p => p.id === lastSold.playerId)
      if (fallbackIdx >= 0) team.players.splice(fallbackIdx, 1)
    }
  }

  team.budget += Number(lastSold.soldPrice) || 0
  team.spent = Math.max(0, (Number(team.spent) || 0) - (Number(lastSold.soldPrice) || 0))

  room.players[lastSold.playerIdx] = {
    ...lastSold.playerBefore,
    status: 'unsold',
    soldTo: null,
    soldPrice: null,
    soldAt: null,
  }
  room.currentIdx = lastSold.currentIdx
  room.currentPrice = room.players[lastSold.playerIdx].basePrice
  room.leadingTeamId = null
  room.bids = []
  room.status = 'unsold'
  room.paused = false
  room.timerLeft = room.config.timerEnabled ? room.config.timerSeconds : room.timerLeft

  io.to(roomCode).emit('auction:unsold', publicState(room))
  return publicState(room)
}

function reopenSoldPlayer(roomCode, io) {
  const room = getRoom(roomCode)
  if (!room) return { error: 'Room not found' }
  if (!room.soldHistory.length) return { error: 'No sold player to reopen' }

  clearTimer(room)
  const lastSold = room.soldHistory.pop()
  const team = room.teams.find(t => t.id === lastSold.teamId)
  if (!team) return { error: 'Winning team not found' }

  // Remove this player from the winner roster and refund budget.
  if (team.players.length > 0) {
    const lastIdx = team.players.length - 1
    if (team.players[lastIdx]?.id === lastSold.playerId) {
      team.players.pop()
    } else {
      const fallbackIdx = team.players.findLastIndex(p => p.id === lastSold.playerId)
      if (fallbackIdx >= 0) team.players.splice(fallbackIdx, 1)
    }
  }

  team.budget += Number(lastSold.soldPrice) || 0
  team.spent = Math.max(0, (Number(team.spent) || 0) - (Number(lastSold.soldPrice) || 0))

  room.players[lastSold.playerIdx] = {
    ...lastSold.playerBefore,
    status: 'pending',
    soldTo: null,
    soldPrice: null,
    soldAt: null,
  }
  room.currentIdx = lastSold.currentIdx
  room.currentPrice = Number(lastSold.soldPrice) || room.players[lastSold.playerIdx].basePrice
  room.leadingTeamId = lastSold.teamId
  room.bids = [{ teamId: lastSold.teamId, price: Number(lastSold.soldPrice) || room.currentPrice, ts: Date.now() }]
  room.status = 'running'
  room.paused = false
  room.timerLeft = room.config.timerEnabled ? room.config.timerSeconds : room.timerLeft

  if (room.config.timerEnabled) startTimer(roomCode, room, io)

  io.to(roomCode).emit('auction:stateUpdate', publicState(room))
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

function returnSoldPlayerToQueue(roomCode, playerId, io) {
  const room = getRoom(roomCode)
  if (!room) return { error: 'Room not found' }

  const playerIdx = room.players.findIndex(p => p.id === playerId)
  if (playerIdx < 0) return { error: 'Player not found' }

  const player = room.players[playerIdx]
  if (player.status !== 'sold' || !player.soldTo) return { error: 'Player is not currently sold' }

  const team = room.teams.find(t => t.id === player.soldTo)
  if (!team) return { error: 'Winning team not found' }

  const soldPrice = Number(player.soldPrice) || 0
  const rosterIdx = team.players.findIndex(p => p.id === player.id)
  if (rosterIdx >= 0) team.players.splice(rosterIdx, 1)

  team.budget += soldPrice
  team.spent = Math.max(0, (Number(team.spent) || 0) - soldPrice)

  room.players[playerIdx] = {
    ...player,
    status: 'pending',
    soldTo: null,
    soldPrice: null,
    soldAt: null,
  }
  room.soldHistory = room.soldHistory.filter(entry => entry.playerId !== playerId)

  if (!room.queue.slice(room.currentIdx + 1).includes(playerIdx)) {
    room.queue.push(playerIdx)
  }

  if (room.status === 'finished') {
    room.status = 'idle'
  }

  io.to(roomCode).emit('auction:stateUpdate', publicState(room))
  return publicState(room)
}

function pauseAuction(roomCode, io) {
  const room = getRoom(roomCode)
  if (!room || room.status !== 'running') return { error: 'Not running' }
  clearTimer(room)
  room.paused = true
  io.to(roomCode).emit('auction:stateUpdate', publicState(room))
  return publicState(room)
}

function resumeAuction(roomCode, io) {
  const room = getRoom(roomCode)
  if (!room || !room.paused) return { error: 'Not paused' }
  room.paused = false
  if (room.config.timerEnabled && room.timerLeft > 0) startTimer(roomCode, room, io)
  io.to(roomCode).emit('auction:stateUpdate', publicState(room))
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

function restoreRoom(roomCode, snapshot, originalSetup) {
  const room = makeRoom(snapshot.config || originalSetup.config)

  // Merge snapshot teams (live budget/roster) with PINs from original setup
  room.teams = snapshot.teams.map(snapshotTeam => {
    const orig = (originalSetup.teams || []).find(t => t.id === snapshotTeam.id) || {}
    return { ...snapshotTeam, pin: orig.pin || '' }
  })

  room.players = snapshot.players || []
  room.queue = snapshot.queue || []
  room.currentIdx = snapshot.currentIdx ?? -1
  room.currentPrice = snapshot.currentPrice
  room.leadingTeamId = snapshot.leadingTeamId
  room.bids = snapshot.bids || []
  room.status = snapshot.status
  room.timerLeft = null  // timer does not auto-resume; admin proceeds manually
  room.secondRound = snapshot.secondRound || false
  room.soldHistory = snapshot.soldHistory || []

  rooms.set(roomCode, room)
  return room
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

function autoAssignUnsold(roomCode, io) {
  const room = getRoom(roomCode)
  if (!room) return { error: 'Room not found' }

  // Get all unsold players
  const unsoldIdxs = room.players.reduce((acc, p, i) => p.status === 'unsold' ? [...acc, i] : acc, [])
  if (!unsoldIdxs.length) return { error: 'No unsold players' }

  const maxPlayers = Number(room.config.maxPlayersPerTeam) || 0

  // Shuffle unsold indices for random assignment
  const shuffled = [...unsoldIdxs]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  // Assign players to teams with available spots
  shuffled.forEach(playerIdx => {
    const unsoldPlayer = room.players[playerIdx]
    const basePrice = Number(unsoldPlayer.basePrice) || 0
    
    // Find teams with available roster spots, prioritize teams with fewer players
    const availableTeams = room.teams
      .filter(t => {
        if (maxPlayers > 0 && t.players.length >= maxPlayers) return false
        if (Number(t.budget) < basePrice) return false

        // Keep budget-safe roster completion guarantees aligned with bid logic.
        if (maxPlayers > 0) {
          const spotsFilledAfter = t.players.length + 1
          const spotsNeededAfter = Math.max(0, maxPlayers - spotsFilledAfter)
          const minNeeded = minCostForRemainingSpots(room.players, playerIdx, spotsNeededAfter)
          if (Number(t.budget) - basePrice < minNeeded) return false
        }

        return true
      })
      .sort((a, b) => a.players.length - b.players.length)
    
    if (availableTeams.length > 0) {
      const assignedTeam = availableTeams[0]
      const soldAt = Date.now()
      // Assign this player to the team
      const playerWithPrice = { ...unsoldPlayer, soldPrice: basePrice, soldAt }
      assignedTeam.players.push(playerWithPrice)
      assignedTeam.budget -= basePrice
      assignedTeam.spent = (assignedTeam.spent || 0) + basePrice
      
      // Update player status
      room.players[playerIdx] = {
        ...unsoldPlayer,
        status: 'sold',
        soldTo: assignedTeam.id,
        soldPrice: basePrice,
        soldAt,
      }
    }
  })

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
    status: room.status,    paused: room.paused,    timerLeft: room.timerLeft,
    secondRound: room.secondRound,
    canUndoSold: room.soldHistory.length > 0,
    connectedTeamIds: [...room.connectedCaptains.values()],
  }
}

function viewerState(room) {
  const full = publicState(room)
  return {
    ...full,
    // Hide exact budgets — replace with percentage only
    teams: full.teams.map(t => ({
      id: t.id,
      name: t.name,
      players: t.players,
      playerCount: t.players.length,
      budgetPct: Math.round((t.budget / room.config.pointsPerTeam) * 100),
    })),
  }
}

module.exports = {
  createRoom,
  getRoom,
  joinRoom,
  connectCaptain,
  disconnectCaptain,
  checkCaptainJoin,
  startNextPlayer,
  placeBid,
  undoBid,
  sellPlayer,
  reopenSoldPlayer,
  undoSoldPlayer,
  unsellPlayer,
  returnSoldPlayerToQueue,
  pauseAuction,
  resumeAuction,
  finishAuction,
  requeueUnsold,
  autoAssignUnsold,
  restoreRoom,
  publicState,
  viewerState,
}
