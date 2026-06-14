const express = require('express')
const { createServer } = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const path = require('path')
const engine = require('./auction-engine')

const app = express()
const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
})

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
  res.json({ ok: true, roomCode })
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
  const result = engine.joinRoom(req.params.roomCode, pin)
  if (result.error) return res.status(401).json(result)
  res.json({ teamId: result.team.id, teamName: result.team.name })
})

// ── Socket.io ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentRoom = null
  let currentTeamId = null
  let isAdmin = false

  // Join as admin
  socket.on('admin:join', ({ roomCode }) => {
    const room = engine.getRoom(roomCode)
    if (!room) { socket.emit('error', { message: 'Room not found' }); return }
    currentRoom = roomCode
    isAdmin = true
    socket.join(roomCode)
    socket.emit('auction:stateUpdate', engine.publicState(room))
  })

  // Join as captain (after REST validation)
  socket.on('captain:join', ({ roomCode, teamId }) => {
    const room = engine.getRoom(roomCode)
    if (!room) { socket.emit('error', { message: 'Room not found' }); return }
    currentRoom = roomCode
    currentTeamId = teamId
    socket.join(roomCode)
    engine.connectCaptain(roomCode, teamId, socket.id)
    socket.emit('auction:stateUpdate', engine.publicState(room))
    io.to(roomCode).emit('captain:connected', { teamId, connectedTeamIds: engine.publicState(room).connectedTeamIds })
  })

  // Admin: start next player
  socket.on('admin:nextPlayer', () => {
    if (!isAdmin || !currentRoom) return
    engine.startNextPlayer(currentRoom, io)
  })

  // Captain: place bid
  socket.on('captain:bid', () => {
    if (!currentTeamId || !currentRoom) return
    const result = engine.placeBid(currentRoom, currentTeamId, io)
    if (result.error) socket.emit('bid:rejected', { reason: result.error })
  })

  // Admin: undo last bid
  socket.on('admin:undoBid', () => {
    if (!isAdmin || !currentRoom) return
    engine.undoBid(currentRoom, io)
  })

  // Admin: mark sold (manual mode)
  socket.on('admin:sold', () => {
    if (!isAdmin || !currentRoom) return
    engine.sellPlayer(currentRoom, io)
  })

  // Admin: mark unsold
  socket.on('admin:unsold', () => {
    if (!isAdmin || !currentRoom) return
    engine.unsellPlayer(currentRoom, io)
  })

  // Admin: finish auction early
  socket.on('admin:finish', () => {
    if (!isAdmin || !currentRoom) return
    engine.finishAuction(currentRoom, io)
  })

  // Admin: re-queue unsold players
  socket.on('admin:requeueUnsold', () => {
    if (!isAdmin || !currentRoom) return
    engine.requeueUnsold(currentRoom, io)
  })

  // Disconnect
  socket.on('disconnect', () => {
    if (currentRoom && currentTeamId) {
      engine.disconnectCaptain(currentRoom, socket.id)
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
const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => {
  console.log(`Auction server running on port ${PORT}`)
})
