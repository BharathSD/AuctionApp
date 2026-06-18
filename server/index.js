const express = require('express')
const { createServer } = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const path = require('path')
const crypto = require('crypto')
const engine = require('./auction-engine')

// Keep the process alive — log unexpected errors instead of crashing
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message)
})
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

const app = express()
const httpServer = createServer(app)

// Track admin tokens and rate limits
const adminTokens = new Map() // roomCode -> adminToken
const bidRateLimitMap = new Map() // `${roomCode}:${teamId}` -> { count, resetTime }
const captainTokens = new Map() // roomCode -> Map<teamId, token>
const BID_RATE_LIMIT = 3 // max 3 bids per second per team
const RATE_LIMIT_WINDOW = 1000 // milliseconds

// ── Admin auth helper ──────────────────────────────────────────
function generateAdminToken() {
  return Math.random().toString(36).slice(2, 12)
}

function generateCaptainToken() {
  return crypto.randomBytes(24).toString('hex')
}

function getCaptainTokenMap(roomCode) {
  if (!captainTokens.has(roomCode)) captainTokens.set(roomCode, new Map())
  return captainTokens.get(roomCode)
}

function validateCaptainSession(room, roomCode, teamId, captainToken) {
  const team = room.teams.find(t => t.id === teamId)
  if (!team) return 'Invalid team for this room.'

  const expectedCaptainToken = captainTokens.get(roomCode)?.get(teamId)
  if (!expectedCaptainToken || captainToken !== expectedCaptainToken) {
    return 'Invalid captain session. Please rejoin with PIN.'
  }
  return null
}

function resetServerStateForTests() {
  adminTokens.clear()
  captainTokens.clear()
  bidRateLimitMap.clear()
}

// Swallow aborted connection errors on the HTTP server (ECONNABORTED, ECONNRESET)
httpServer.on('clientError', (err, socket) => {
  console.warn('[clientError]', err.message)
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
  else socket.destroy()
})

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
})

// Broadcast to both the main room and the viewer room
function broadcast(roomCode, event, data) {
  io.to(roomCode).emit(event, data)
  const room = engine.getRoom(roomCode)
  if (room) io.to(`${roomCode}:viewers`).emit(event, engine.viewerState(room))
}

// Proxy io so the engine automatically broadcasts to viewers too
function makeIoProxy(roomCode) {
  return {
    to: (rc) => ({
      emit: (event, data) => {
        io.to(rc).emit(event, data)
        const room = engine.getRoom(roomCode)
        if (!room) return
        const viewersRoom = `${roomCode}:viewers`
        // Lightweight events carry no sensitive data — pass through as-is
        // Full state events — send viewer-safe state (hides exact budgets)
        const passThrough = ['bid:accepted', 'timer:tick', 'captain:connected', 'captain:disconnected']
        if (passThrough.includes(event)) {
          io.to(viewersRoom).emit(event, data)
        } else {
          io.to(viewersRoom).emit(event, engine.viewerState(room))
        }
      },
    }),
  }
}

app.use(cors())
app.use(express.json())

// ── Serve React app in production ────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')))
}

// ── REST: Create auction room ─────────────────────────────────
app.post('/api/auction/create', (req, res) => {
  const { roomCode, auctionData } = req.body
  if (!roomCode || !auctionData) return res.status(400).json({ error: 'Missing roomCode or auctionData' })
  engine.createRoom(roomCode, auctionData)
  
  // Generate admin token for this room
  const adminToken = generateAdminToken()
  adminTokens.set(roomCode, adminToken)
  captainTokens.set(roomCode, new Map())
  
  res.json({ ok: true, roomCode, adminToken })
})

// ── REST: Get room state (for page reload) ────────────────────
app.get('/api/auction/:roomCode/state', (req, res) => {
  const room = engine.getRoom(req.params.roomCode)
  if (!room) return res.status(404).json({ error: 'Room not found' })
  res.json(engine.publicState(room))
})

// ── REST: Validate captain join ───────────────────────────────
app.post('/api/auction/:roomCode/join', (req, res) => {
  const { pin } = req.body
  const roomCode = req.params.roomCode
  const result = engine.joinRoom(roomCode, pin)
  if (result.error) return res.status(401).json(result)
  const captainToken = generateCaptainToken()
  const roomTokens = getCaptainTokenMap(roomCode)
  roomTokens.set(result.team.id, captainToken)
  res.json({ teamId: result.team.id, teamName: result.team.name, captainToken })
})

// ── REST: Restore auction room from snapshot ─────────────────
app.post('/api/auction/restore', (req, res) => {
  const { roomCode, snapshot, originalSetup, adminToken } = req.body
  if (!roomCode || !snapshot || !originalSetup) return res.status(400).json({ error: 'Missing data' })
  const expectedToken = adminTokens.get(roomCode)
  if (!expectedToken || adminToken !== expectedToken) {
    return res.status(401).json({ error: 'Invalid admin token' })
  }
  engine.restoreRoom(roomCode, snapshot, originalSetup)
  res.json({ ok: true, roomCode, restored: true })
})

// ── Socket.io ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Swallow transport-level errors (ECONNABORTED, ECONNRESET, etc.)
  socket.on('error', (err) => {
    console.warn('[socket error]', err.message)
  })

  let currentRoom = null
  let currentTeamId = null
  let isAdmin = false
  // Join as admin (requires token)
  socket.on('admin:join', ({ roomCode, adminToken }) => {
    const room = engine.getRoom(roomCode)
    if (!room) { socket.emit('error', { message: 'Room not found' }); return }
    
    // Validate admin token
    const expectedToken = adminTokens.get(roomCode)
    if (!expectedToken || adminToken !== expectedToken) {
      socket.emit('error', { message: 'Invalid admin token' })
      return
    }
    
    currentRoom = roomCode
    isAdmin = true
    socket.join(roomCode)
    socket.emit('auction:stateUpdate', engine.publicState(room))
  })

  // Join as viewer (read-only, no controls)
  socket.on('viewer:join', ({ roomCode }) => {
    const room = engine.getRoom(roomCode)
    if (!room) { socket.emit('error', { message: 'Room not found' }); return }
    currentRoom = roomCode
    socket.join(`${roomCode}:viewers`)
    socket.emit('auction:stateUpdate', engine.viewerState(room))
  })

  // Join as captain (after REST validation)
  socket.on('captain:join', ({ roomCode, teamId, captainToken }) => {
    const room = engine.getRoom(roomCode)
    if (!room) { socket.emit('error', { message: 'Room not found' }); return }

    const sessionError = validateCaptainSession(room, roomCode, teamId, captainToken)
    if (sessionError) {
      socket.emit('session:rejected', { reason: sessionError })
      return
    }

    const conflict = engine.checkCaptainJoin(roomCode, teamId)
    if (conflict === 'already_connected') {
      socket.emit('session:rejected', { reason: 'This team is already connected from another device.' })
      return
    }

    currentRoom = roomCode
    currentTeamId = teamId
    socket.join(roomCode)
    engine.connectCaptain(roomCode, teamId, socket.id, makeIoProxy(roomCode))
    socket.emit('auction:stateUpdate', engine.publicState(room))
    io.to(roomCode).emit('captain:connected', { teamId, connectedTeamIds: engine.publicState(room).connectedTeamIds })
  })

  // Admin: start next player
  socket.on('admin:nextPlayer', () => {
    if (!isAdmin || !currentRoom) return
    engine.startNextPlayer(currentRoom, makeIoProxy(currentRoom))
  })

  // Captain: place bid (rate limited)
  socket.on('captain:bid', () => {
    if (!currentTeamId || !currentRoom) return

    // Rate limiting: max BID_RATE_LIMIT bids per RATE_LIMIT_WINDOW ms per team
    const now = Date.now()
    const rateKey = `${currentRoom}:${currentTeamId}`
    const attempts = bidRateLimitMap.get(rateKey) || { count: 0, resetTime: now }
    if (attempts.resetTime + RATE_LIMIT_WINDOW < now) {
      attempts.count = 0
      attempts.resetTime = now
    }

    attempts.count += 1
    bidRateLimitMap.set(rateKey, attempts)
    if (attempts.count > BID_RATE_LIMIT) {
      socket.emit('bid:rejected', { reason: 'Bid rate limit exceeded. Wait before bidding again.' })
      return
    }
    
    const result = engine.placeBid(currentRoom, currentTeamId, makeIoProxy(currentRoom))
    if (result.error) socket.emit('bid:rejected', { reason: result.error })
  })

  // Admin: undo last bid
  socket.on('admin:undoBid', () => {
    if (!isAdmin || !currentRoom) return
    engine.undoBid(currentRoom, makeIoProxy(currentRoom))
  })

  // Admin: mark sold (manual mode)
  socket.on('admin:sold', () => {
    if (!isAdmin || !currentRoom) return
    engine.sellPlayer(currentRoom, makeIoProxy(currentRoom))
  })

  // Admin: mark unsold
  socket.on('admin:unsold', () => {
    if (!isAdmin || !currentRoom) return
    engine.unsellPlayer(currentRoom, makeIoProxy(currentRoom))
  })

  // Admin: finish auction early
  socket.on('admin:finish', () => {
    if (!isAdmin || !currentRoom) return
    engine.finishAuction(currentRoom, makeIoProxy(currentRoom))
  })

  // Admin: pause auction
  socket.on('admin:pause', () => {
    if (!isAdmin || !currentRoom) return
    engine.pauseAuction(currentRoom, makeIoProxy(currentRoom))
  })

  // Admin: resume auction
  socket.on('admin:resume', () => {
    if (!isAdmin || !currentRoom) return
    engine.resumeAuction(currentRoom, makeIoProxy(currentRoom))
  })

  // Admin: kick a team's captain connection
  socket.on('admin:kickTeam', ({ teamId }) => {
    if (!isAdmin || !currentRoom) return
    const room = engine.getRoom(currentRoom)
    if (!room) return
    const session = room.captainSessions.get(teamId)
    if (session && session.socketId) {
      const targetSocket = io.sockets.sockets.get(session.socketId)
      if (targetSocket) {
        targetSocket.emit('session:kicked', { reason: 'You have been disconnected by the auctioneer.' })
        targetSocket.disconnect(true)
      }
    }
  })

  // Admin: re-queue unsold players
  socket.on('admin:requeueUnsold', () => {
    if (!isAdmin || !currentRoom) return
    engine.requeueUnsold(currentRoom, makeIoProxy(currentRoom))
  })

  // Disconnect
  socket.on('disconnect', () => {
    if (currentRoom && currentTeamId) {
      engine.disconnectCaptain(currentRoom, socket.id, makeIoProxy(currentRoom))
      io.to(currentRoom).emit('captain:disconnected', { teamId: currentTeamId })
    }
  })
})

// ── SPA catch-all (must be after API routes) ─────────────────
if (process.env.NODE_ENV === 'production') {
  app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'))
  })
}

// ── Start ─────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3001
  httpServer.listen(PORT, () => {
    console.log(`Auction server running on port ${PORT}`)
  })
}

module.exports = {
  app,
  httpServer,
  validateCaptainSession,
  _test: {
    adminTokens,
    captainTokens,
    bidRateLimitMap,
    resetServerStateForTests,
  },
}
