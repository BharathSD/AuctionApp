const express = require('express')
const { createServer } = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const path = require('path')
const crypto = require('crypto')
const engine = require('./auction-engine')
const persistence = require('./persistence')

function isIgnorableNetworkError(err) {
  const code = err?.code || ''
  const message = String(err?.message || '')
  return code === 'ECONNABORTED' || code === 'ECONNRESET' || code === 'EPIPE'
    || /ECONNABORTED|ECONNRESET|EPIPE/i.test(message)
}

// Keep the process alive — log unexpected errors instead of crashing
process.on('uncaughtException', (err) => {
  if (isIgnorableNetworkError(err)) return
  console.error('[uncaughtException]', err.message)
})
process.on('unhandledRejection', (reason) => {
  if (isIgnorableNetworkError(reason)) return
  console.error('[unhandledRejection]', reason)
})

const app = express()
const httpServer = createServer(app)

// Track admin tokens and rate limits
const adminTokens = new Map() // roomCode -> adminToken
const bidRateLimitMap = new Map() // `${roomCode}:${teamId}` -> { count, resetTime }
const joinAttemptMap = new Map() // `${roomCode}:${ip}` -> { count, resetTime }
const captainTokens = new Map() // roomCode -> Map<teamId, token>
const BID_RATE_LIMIT = 3 // max 3 bids per second per team
const RATE_LIMIT_WINDOW = 1000 // milliseconds
const JOIN_RATE_LIMIT = 8 // max 8 PIN attempts per minute per room/IP
const JOIN_RATE_LIMIT_WINDOW = 60_000 // milliseconds

function pruneStaleRateLimitEntries(now) {
  for (const [key, value] of bidRateLimitMap.entries()) {
    if (!value || Number(value.resetTime) + RATE_LIMIT_WINDOW < now) {
      bidRateLimitMap.delete(key)
    }
  }
}

function pruneStaleJoinEntries(now) {
  for (const [key, value] of joinAttemptMap.entries()) {
    if (!value || Number(value.resetTime) + JOIN_RATE_LIMIT_WINDOW < now) {
      joinAttemptMap.delete(key)
    }
  }
}

function getRequestIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return fwd || req.ip || req.socket?.remoteAddress || 'unknown'
}

// ── Admin auth helper ──────────────────────────────────────────
function generateAdminToken() {
  return crypto.randomBytes(24).toString('hex')
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
  joinAttemptMap.clear()
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
          io.to(viewersRoom).emit(event, engine.viewerRoomState(room))
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
  if (engine.getRoom(roomCode)) return res.status(409).json({ error: 'Room already exists' })
  if (auctionData.config?.engine === 'draft') engine.createDraftRoom(roomCode, auctionData)
  else engine.createRoom(roomCode, auctionData)
  
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
  res.json(engine.roomState(room))
})

// ── REST: Validate captain join ───────────────────────────────
app.post('/api/auction/:roomCode/join', (req, res) => {
  const { pin } = req.body
  const roomCode = req.params.roomCode

  // PIN join throttling to reduce brute-force attempts.
  const now = Date.now()
  pruneStaleJoinEntries(now)
  const joinKey = `${roomCode}:${getRequestIp(req)}`
  const attempts = joinAttemptMap.get(joinKey) || { count: 0, resetTime: now }
  if (attempts.resetTime + JOIN_RATE_LIMIT_WINDOW < now) {
    attempts.count = 0
    attempts.resetTime = now
  }
  attempts.count += 1
  joinAttemptMap.set(joinKey, attempts)
  if (attempts.count > JOIN_RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many join attempts. Please wait a minute and try again.' })
  }

  const result = engine.joinRoom(roomCode, pin)
  if (result.error) return res.status(401).json(result)

  const conflict = engine.checkCaptainJoin(roomCode, result.team.id)
  if (conflict === 'already_connected') {
    return res.status(409).json({ error: 'This team is already connected from another device.' })
  }

  const captainToken = generateCaptainToken()
  const roomTokens = getCaptainTokenMap(roomCode)
  roomTokens.set(result.team.id, captainToken)
  // Successful validation resets throttling for this room/IP key.
  joinAttemptMap.delete(joinKey)
  res.json({
    teamId: result.team.id,
    teamName: result.team.name,
    captainToken,
    engine: result.room?.config?.engine || 'bidding',
  })
})

// ── REST: Restore auction room from snapshot ─────────────────
app.post('/api/auction/restore', (req, res) => {
  const { roomCode, snapshot, originalSetup, adminToken } = req.body
  if (!roomCode || !snapshot || !originalSetup) return res.status(400).json({ error: 'Missing data' })
  const expectedToken = adminTokens.get(roomCode)
  if (!expectedToken || adminToken !== expectedToken) {
    return res.status(401).json({ error: 'Invalid admin token' })
  }
  const engineType = snapshot?.config?.engine || originalSetup?.config?.engine
  if (engineType === 'draft') engine.restoreDraftRoom(roomCode, snapshot, originalSetup)
  else engine.restoreRoom(roomCode, snapshot, originalSetup)
  res.json({ ok: true, roomCode, restored: true })
})

// ── Socket.io ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Swallow transport-level errors (ECONNABORTED, ECONNRESET, etc.)
  socket.on('error', (err) => {
    console.warn('[socket error]', err.message)
    socket.emit('session:rejected', { reason: err?.message || 'Socket error' })
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
    socket.emit('auction:stateUpdate', engine.roomState(room))
  })

  // Join as viewer (read-only, no controls)
  socket.on('viewer:join', ({ roomCode }) => {
    const room = engine.getRoom(roomCode)
    if (!room) { socket.emit('error', { message: 'Room not found' }); return }
    currentRoom = roomCode
    socket.join(`${roomCode}:viewers`)
    socket.emit('auction:stateUpdate', engine.viewerRoomState(room))
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
    socket.emit('auction:stateUpdate', engine.roomState(room))
    io.to(roomCode).emit('captain:connected', { teamId, connectedTeamIds: engine.roomState(room).connectedTeamIds })
  })

  // Admin: start next player
  socket.on('admin:nextPlayer', () => {
    if (!isAdmin || !currentRoom) return
    engine.startNextPlayer(currentRoom, makeIoProxy(currentRoom))
  })

  // Admin: randomize the team pick order (draft mode) — explicit action,
  // must run before startDraft; can be re-run while still idle.
  socket.on('admin:randomizePickOrder', () => {
    if (!isAdmin || !currentRoom) return
    engine.randomizePickOrder(currentRoom, makeIoProxy(currentRoom))
  })

  // Admin: start the draft (round robin mode's "begin" action)
  socket.on('admin:startDraft', () => {
    if (!isAdmin || !currentRoom) return
    engine.startDraft(currentRoom, makeIoProxy(currentRoom))
  })

  // Admin: pick a player on behalf of the on-turn team (draft mode)
  socket.on('admin:pick', ({ playerId }) => {
    if (!isAdmin || !currentRoom || !playerId) return
    const room = engine.getRoom(currentRoom)
    if (!room) return
    const teamId = room.pickOrder?.[room.currentTurnIdx]
    if (!teamId) return
    engine.pickPlayer(currentRoom, teamId, playerId, makeIoProxy(currentRoom))
  })

  // Admin: undo the last draft pick
  socket.on('admin:undoPick', () => {
    if (!isAdmin || !currentRoom) return
    engine.undoPick(currentRoom, makeIoProxy(currentRoom))
  })

  // Captain: place bid (rate limited)
  socket.on('captain:bid', () => {
    if (!currentTeamId || !currentRoom) return

    // Rate limiting: max BID_RATE_LIMIT bids per RATE_LIMIT_WINDOW ms per team
    const now = Date.now()
    pruneStaleRateLimitEntries(now)
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

  // Captain: pick a player on their team's turn (draft mode)
  socket.on('captain:pick', ({ playerId }) => {
    if (!currentTeamId || !currentRoom || !playerId) return
    const result = engine.pickPlayer(currentRoom, currentTeamId, playerId, makeIoProxy(currentRoom))
    if (result.error) socket.emit('pick:rejected', { reason: result.error })
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

  // Admin: undo last sold player
  socket.on('admin:undoSold', () => {
    if (!isAdmin || !currentRoom) return
    engine.undoSoldPlayer(currentRoom, makeIoProxy(currentRoom))
  })

  // Admin: reopen last sold player for bidding
  socket.on('admin:reopenSold', () => {
    if (!isAdmin || !currentRoom) return
    engine.reopenSoldPlayer(currentRoom, makeIoProxy(currentRoom))
  })

  // Admin: return any sold player to the queue for later re-auction
  socket.on('admin:returnSoldToQueue', ({ playerId }) => {
    if (!isAdmin || !currentRoom || !playerId) return
    engine.returnSoldPlayerToQueue(currentRoom, playerId, makeIoProxy(currentRoom))
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

  // Admin: auto-assign unsold players
  socket.on('admin:autoAssignUnsold', () => {
    if (!isAdmin || !currentRoom) return
    engine.autoAssignUnsold(currentRoom, makeIoProxy(currentRoom))
  })

  // Disconnect
  socket.on('disconnect', () => {
    if (currentRoom && currentTeamId) {
      engine.disconnectCaptain(currentRoom, socket.id, makeIoProxy(currentRoom))
      io.to(currentRoom).emit('captain:disconnected', { teamId: currentTeamId })
    }
  })
})

// ── Image proxy — same server, re-serves external player photos from this origin
// so every viewing device (captain phones, viewer TV) can load them even if their
// network/browser blocks the third-party host (CORS/ORB/hotlink/firewall).
function isBlockedImageHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '')
  return (
    h === 'localhost' || h === '0.0.0.0' || h === '::1' ||
    h.endsWith('.local') ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  )
}

app.get('/api/img-proxy', async (req, res) => {
  const url = req.query.url
  if (!url || typeof url !== 'string') return res.status(400).send('missing url')
  let parsed
  try { parsed = new URL(url) } catch { return res.status(400).send('bad url') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return res.status(400).send('bad protocol')
  if (isBlockedImageHost(parsed.hostname)) return res.status(403).send('blocked host')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const upstream = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'AuctionApp-ImageProxy/1.0', Accept: 'image/*' },
    })
    if (!upstream.ok) return res.status(502).send('upstream error')
    const contentType = upstream.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) return res.status(415).send('not an image')
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (buf.length > 8 * 1024 * 1024) return res.status(413).send('image too large')
    res.set('Content-Type', contentType)
    res.set('Cache-Control', 'public, max-age=86400')
    res.set('Cross-Origin-Resource-Policy', 'same-origin')
    return res.send(buf)
  } catch {
    return res.status(502).send('fetch failed')
  } finally {
    clearTimeout(timeout)
  }
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

  // Crash recovery: restore any persisted rooms/tokens from disk.
  const restored = persistence.restoreState({ adminTokens, captainTokens })
  if (restored > 0) console.log(`Restored ${restored} auction room(s) from disk`)

  // Periodically snapshot live state so a crash/restart doesn't lose an auction.
  const SAVE_INTERVAL_MS = 5000
  const saveTimer = setInterval(() => persistence.saveState({ adminTokens, captainTokens }), SAVE_INTERVAL_MS)
  if (typeof saveTimer.unref === 'function') saveTimer.unref()

  // Best-effort save on shutdown.
  let shuttingDown = false
  const shutdown = (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    persistence.saveState({ adminTokens, captainTokens })
    console.log(`Received ${signal}, saved state and shutting down.`)
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

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
    joinAttemptMap,
    isIgnorableNetworkError,
    resetServerStateForTests,
  },
}
