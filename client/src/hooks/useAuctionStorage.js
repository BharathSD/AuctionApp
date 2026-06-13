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
