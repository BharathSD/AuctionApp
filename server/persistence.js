'use strict'
/**
 * Crash-recovery persistence for online auction rooms.
 *
 * Periodically snapshots live room state + auth tokens to a single JSON file
 * (atomic write via temp + rename) so a server restart/crash mid-auction does
 * not lose the auction. On boot the state is loaded back and rooms are
 * re-hydrated into the engine; running rooms come back paused so the auctioneer
 * resumes deliberately.
 */
const fs = require('fs')
const path = require('path')
const engine = require('./auction-engine')

const DATA_DIR = path.join(__dirname, '.data')
const STATE_FILE = path.join(DATA_DIR, 'rooms.json')

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

/** Serialize all live rooms + tokens and atomically write to disk. */
function saveState({ adminTokens, captainTokens }) {
  try {
    ensureDir()
    const rooms = engine.getAllRooms()
    const data = {
      savedAt: Date.now(),
      rooms: Object.fromEntries(
        [...rooms.entries()].map(([code, room]) => [code, engine.serializeRoom(room)])
      ),
      adminTokens: Object.fromEntries(adminTokens),
      captainTokens: Object.fromEntries(
        [...captainTokens.entries()].map(([code, m]) => [code, Object.fromEntries(m)])
      ),
    }
    const tmp = STATE_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data))
    fs.renameSync(tmp, STATE_FILE) // atomic replace
    return true
  } catch (err) {
    console.warn('[persistence] save failed:', err.message)
    return false
  }
}

/** Load persisted state from disk, or null if none/invalid. */
function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Restore rooms + tokens from disk into the engine and the given token maps.
 * Returns the number of rooms restored.
 */
function restoreState({ adminTokens, captainTokens }) {
  const data = loadState()
  if (!data || !data.rooms) return 0
  let count = 0
  for (const [code, serialized] of Object.entries(data.rooms)) {
    try {
      engine.hydrateRoom(code, serialized)
      count++
    } catch (err) {
      console.warn(`[persistence] could not restore room ${code}:`, err.message)
    }
  }
  for (const [code, token] of Object.entries(data.adminTokens || {})) {
    adminTokens.set(code, token)
  }
  for (const [code, teamMap] of Object.entries(data.captainTokens || {})) {
    captainTokens.set(code, new Map(Object.entries(teamMap)))
  }
  return count
}

module.exports = { saveState, loadState, restoreState, STATE_FILE, DATA_DIR }
