import { useState, useEffect } from 'react'
import { loadOnlineLiveSnapshot } from './useAuctionStorage'

// Shared "smart mount" bootstrap for any online admin console: check if the
// room already exists → restore from local snapshot if not → create fresh
// if there's no snapshot either. Engine-agnostic — /api/auction/create and
// /api/auction/restore already branch server-side on config.engine — so
// both the bidding and draft admin pages can use this unchanged.
export function useRoomBootstrap(saved) {
  const [roomReady, setRoomReady] = useState(false)
  const [bootstrapError, setBootstrapError] = useState('')
  const [restored, setRestored] = useState(false)

  // Intentionally bootstrap once on mount using the initial saved setup snapshot.
  useEffect(() => {
    if (!saved || !saved.roomCode) return
    const rc = saved.roomCode
    fetch(`/api/auction/${rc}/state`)
      .then(r => {
        if (r.ok) { setRoomReady(true); return }
        const liveSnapshot = loadOnlineLiveSnapshot()
        if (liveSnapshot && liveSnapshot.roomCode === rc) {
          return fetch('/api/auction/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomCode: rc, snapshot: liveSnapshot.state, originalSetup: saved, adminToken: saved.adminToken }),
          }).then(async (resp) => {
            const data = await resp.json().catch(() => ({}))
            if (!resp.ok) throw new Error(data.error || 'Restore failed')
            setRestored(true)
            setRoomReady(true)
          })
        }
        return fetch('/api/auction/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomCode: rc, auctionData: saved }),
        }).then(async (resp) => {
          const data = await resp.json().catch(() => ({}))
          if (!resp.ok) throw new Error(data.error || 'Failed to create room')
          setRoomReady(true)
        })
      })
      .catch((err) => {
        setBootstrapError(err?.message || 'Failed to initialize room')
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { roomReady, bootstrapError, restored }
}
