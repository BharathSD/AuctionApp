// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveAuctionConfig,
  loadAuctionState,
  saveOnlineLiveSnapshot,
  loadOnlineLiveSnapshot,
  clearOnlineLiveSnapshot,
  clearAuctionState,
  syncOnlineAuctionProgress,
  loadBestAvailableAuctionData,
} from './useAuctionStorage'

describe('useAuctionStorage helpers', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('loadBestAvailableAuctionData prefers matching-room live snapshot', () => {
    saveAuctionConfig({ roomCode: 'ABCD12', teams: [{ id: 't1', name: 'A' }], players: [{ id: 'p1', status: 'pending' }], config: {} })
    saveOnlineLiveSnapshot({
      roomCode: 'ABCD12',
      state: {
        teams: [{ id: 't1', name: 'A', budget: 900 }],
        players: [{ id: 'p1', status: 'sold', soldTo: 't1', soldPrice: 100 }],
        config: { pointsPerTeam: 1000 },
      },
    })

    const data = loadBestAvailableAuctionData()
    expect(data.players[0].status).toBe('sold')
    expect(data.teams[0].budget).toBe(900)
  })

  it('loadBestAvailableAuctionData ignores snapshot from different room', () => {
    saveAuctionConfig({ roomCode: 'ROOM_A', teams: [{ id: 't1', name: 'A' }], players: [{ id: 'p1', status: 'pending' }], config: {} })
    saveOnlineLiveSnapshot({
      roomCode: 'ROOM_B',
      state: {
        teams: [{ id: 't1', name: 'A', budget: 900 }],
        players: [{ id: 'p1', status: 'sold', soldTo: 't1', soldPrice: 100 }],
        config: { pointsPerTeam: 1000 },
      },
    })

    const data = loadBestAvailableAuctionData()
    expect(data.players[0].status).toBe('pending')
  })

  it('syncOnlineAuctionProgress syncs state and clears snapshot on finish', () => {
    saveAuctionConfig({ roomCode: 'FIN123', teams: [{ id: 't1', name: 'A' }], players: [{ id: 'p1', status: 'pending' }], config: { pointsPerTeam: 1000 } })

    syncOnlineAuctionProgress({
      roomCode: 'FIN123',
      state: {
        status: 'running',
        teams: [{ id: 't1', name: 'A', budget: 900 }],
        players: [{ id: 'p1', status: 'sold', soldTo: 't1', soldPrice: 100 }],
        config: { pointsPerTeam: 1000 },
      },
    })

    expect(loadOnlineLiveSnapshot()).not.toBeNull()
    expect(loadAuctionState().players[0].status).toBe('sold')

    syncOnlineAuctionProgress({
      roomCode: 'FIN123',
      state: {
        status: 'finished',
        teams: [{ id: 't1', name: 'A', budget: 900 }],
        players: [{ id: 'p1', status: 'sold', soldTo: 't1', soldPrice: 100 }],
        config: { pointsPerTeam: 1000 },
      },
    })

    expect(loadOnlineLiveSnapshot()).toBeNull()
  })

  it('syncOnlineAuctionProgress is a no-op for idle status', () => {
    saveAuctionConfig({ roomCode: 'IDLE1', teams: [{ id: 't1', name: 'A' }], players: [{ id: 'p1', status: 'pending' }], config: { pointsPerTeam: 1000 } })

    clearOnlineLiveSnapshot()
    syncOnlineAuctionProgress({
      roomCode: 'IDLE1',
      state: {
        status: 'idle',
        teams: [{ id: 't1', name: 'A', budget: 1000 }],
        players: [{ id: 'p1', status: 'pending' }],
        config: { pointsPerTeam: 1000 },
      },
    })

    expect(loadOnlineLiveSnapshot()).toBeNull()
    expect(loadAuctionState().players[0].status).toBe('pending')
  })

  it('loadBestAvailableAuctionData returns null when no saved state exists', () => {
    clearAuctionState()
    expect(loadBestAvailableAuctionData()).toBeNull()
  })
})
