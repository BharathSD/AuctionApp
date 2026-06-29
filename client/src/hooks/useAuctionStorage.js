// Persist auction state to localStorage under a fixed key.
// Offline mode uses this as its sole data store.
// Online mode also writes here so the admin can reload the page.

const KEY = 'cricket_auction_state'

export function saveAuctionConfig(data) {
  localStorage.setItem(KEY, JSON.stringify(data))
}

export function loadAuctionState() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function updateAuctionState(updater) {
  const current = loadAuctionState()
  if (!current) return
  const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function clearAuctionState() {
  localStorage.removeItem(KEY)
}

// ── Online live snapshot (auto-save for recovery) ─────────────
const SNAPSHOT_KEY = 'cricket_auction_online_snapshot'

export function saveOnlineLiveSnapshot(data) {
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(data)) } catch (err) { void err }
}

export function loadOnlineLiveSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function clearOnlineLiveSnapshot() {
  localStorage.removeItem(SNAPSHOT_KEY)
}

// Persist online auction progress in one place.
// - Keeps live snapshot for recovery while auction is in progress.
// - Keeps main auction payload synced so results/export always has latest sold players.
export function syncOnlineAuctionProgress({ roomCode, state }) {
  if (!roomCode || !state?.status || state.status === 'idle') return

  if (state.status === 'finished') {
    clearOnlineLiveSnapshot()
  } else {
    saveOnlineLiveSnapshot({ roomCode, state, savedAt: Date.now() })
  }

  updateAuctionState(current => {
    if (!current) return current
    return {
      ...current,
      teams: state.teams,
      players: state.players,
      config: { ...current.config, ...state.config },
    }
  })
}

// Resolve the best available auction data for results/export.
// Online mode prefers matching room live snapshot, then falls back to saved setup state.
export function loadBestAvailableAuctionData() {
  const saved = loadAuctionState()
  if (!saved) return null

  const liveSnapshot = saved.roomCode ? loadOnlineLiveSnapshot() : null
  const liveState = liveSnapshot?.roomCode === saved.roomCode ? liveSnapshot.state : null
  return liveState ? { ...saved, ...liveState } : saved
}
