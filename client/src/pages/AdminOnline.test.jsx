// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import AdminOnline from './AdminOnline'
import { useOnlineAuction } from '../hooks/useOnlineAuction'

const navigateMock = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('../hooks/useAuctionStorage', () => ({
  loadAuctionState: vi.fn(() => ({
    roomCode: 'ROOM42',
    adminToken: 'adm_tok',
    teams: [{ id: 'team1', name: 'Team 1', pin: '1111', budget: 1000, spent: 0, players: [] }],
    players: [],
    config: { numTeams: 1, pointsPerTeam: 1000 },
  })),
  syncOnlineAuctionProgress: vi.fn(),
  updateAuctionState: vi.fn(),
  saveOnlineLiveSnapshot: vi.fn(),
  loadOnlineLiveSnapshot: vi.fn(() => null),
  clearOnlineLiveSnapshot: vi.fn(),
}))

vi.mock('../hooks/useOnlineAuction', () => ({
  useOnlineAuction: vi.fn(() => ({
    state: {
      connected: true,
      status: 'idle',
      players: [],
      teams: [{ id: 'team1', name: 'Team 1', budget: 1000, players: [] }],
      queue: [],
      currentIdx: -1,
      bids: [],
      config: { numTeams: 1, pointsPerTeam: 1000 },
      connectedTeamIds: [],
      secondRound: false,
      paused: false,
      canUndoSold: false,
      sessionError: 'Invalid admin token',
    },
    currentPlayer: null,
    leadingTeam: null,
    adminNextPlayer: vi.fn(),
    adminUndoBid: vi.fn(),
    adminFinish: vi.fn(),
    adminSold: vi.fn(),
    adminReopenSold: vi.fn(),
    adminUndoSold: vi.fn(),
    adminReturnSoldToQueue: vi.fn(),
    adminUnsold: vi.fn(),
    adminRequeueUnsold: vi.fn(),
    adminKickTeam: vi.fn(),
    adminPause: vi.fn(),
    adminResume: vi.fn(),
    adminAutoAssignUnsold: vi.fn(),
  })),
}))

describe('AdminOnline UX', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('shows session error banner with retry action', async () => {
    render(<AdminOnline />)

    await waitFor(() => {
      expect(screen.getByText(/admin session error: invalid admin token/i)).toBeInTheDocument()
    })

    const retryBtn = screen.getByRole('button', { name: /retry/i })
    expect(retryBtn).toBeInTheDocument()
    fireEvent.click(retryBtn)
  })

  it('renders current player photo when photoUrl is provided', async () => {
    useOnlineAuction.mockReturnValue({
      state: {
        connected: true,
        status: 'running',
        players: [{ id: 'p1', name: 'Player 1', role: 'Batsman', basePrice: 100, status: 'pending', photoUrl: 'https://example.com/p1.jpg' }],
        teams: [{ id: 'team1', name: 'Team 1', budget: 1000, players: [] }],
        queue: [0],
        currentIdx: 0,
        bids: [],
        currentPrice: 100,
        leadingTeamId: null,
        timerLeft: 15,
        config: { numTeams: 1, pointsPerTeam: 1000, timerEnabled: true },
        connectedTeamIds: ['team1'],
        secondRound: false,
        paused: false,
        canUndoSold: false,
        sessionError: null,
      },
      currentPlayer: { id: 'p1', name: 'Player 1', role: 'Batsman', basePrice: 100, status: 'pending', photoUrl: 'https://example.com/p1.jpg' },
      leadingTeam: null,
      adminNextPlayer: vi.fn(),
      adminUndoBid: vi.fn(),
      adminFinish: vi.fn(),
      adminSold: vi.fn(),
      adminReopenSold: vi.fn(),
      adminUndoSold: vi.fn(),
      adminReturnSoldToQueue: vi.fn(),
      adminUnsold: vi.fn(),
      adminRequeueUnsold: vi.fn(),
      adminKickTeam: vi.fn(),
      adminPause: vi.fn(),
      adminResume: vi.fn(),
      adminAutoAssignUnsold: vi.fn(),
    })

    render(<AdminOnline />)

    await waitFor(() => {
      expect(screen.getByRole('img', { name: /player 1 photo/i })).toBeInTheDocument()
    })
  })
})
