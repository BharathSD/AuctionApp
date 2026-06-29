// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import CaptainBidding from './CaptainBidding'

const navigateMock = vi.fn()
const clearSessionErrorMock = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('../hooks/useOnlineAuction', () => ({
  useOnlineAuction: vi.fn(),
}))

import { useOnlineAuction } from '../hooks/useOnlineAuction'

function seedCaptainSession() {
  sessionStorage.setItem('captain_roomCode', 'ROOM42')
  sessionStorage.setItem('captain_teamId', 'team1')
  sessionStorage.setItem('captain_teamName', 'Team 1')
  sessionStorage.setItem('captain_token', 'tok_abc')
}

describe('CaptainBidding UX', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    clearSessionErrorMock.mockReset()
    sessionStorage.clear()
    seedCaptainSession()
  })

  it('offers rejoin flow when captain session is rejected', () => {
    useOnlineAuction.mockReturnValue({
      state: {
        sessionError: 'Invalid captain session. Please rejoin with PIN.',
      },
      clearSessionError: clearSessionErrorMock,
      clearError: vi.fn(),
      captainBid: vi.fn(),
      currentPlayer: null,
      leadingTeam: null,
    })

    render(<CaptainBidding />)

    fireEvent.click(screen.getByRole('button', { name: /rejoin with pin/i }))

    expect(clearSessionErrorMock).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('captain_token')).toBeNull()
    expect(navigateMock).toHaveBeenCalledWith('/join/ROOM42')
  })

  it('shows reconnect guidance while running but disconnected', () => {
    useOnlineAuction.mockReturnValue({
      state: {
        connected: false,
        status: 'running',
        paused: false,
        currentPrice: 120,
        leadingTeamId: null,
        timerLeft: 10,
        bids: [],
        config: { timerEnabled: false, maxPlayersPerTeam: 11 },
        teams: [{ id: 'team1', name: 'Team 1', budget: 1000, players: [] }],
        players: [{ id: 'p1', name: 'Player 1', role: 'Batsman', basePrice: 100, status: 'pending' }],
        queue: [0],
        currentIdx: 0,
        sessionError: null,
      },
      clearSessionError: clearSessionErrorMock,
      clearError: vi.fn(),
      captainBid: vi.fn(),
      currentPlayer: { id: 'p1', name: 'Player 1', role: 'Batsman', basePrice: 100, status: 'pending' },
      leadingTeam: null,
    })

    render(<CaptainBidding />)

    expect(screen.getByText(/reconnecting to server\. bidding will resume automatically once connected\./i)).toBeInTheDocument()
  })

  it('renders current player photo when photoUrl is provided', () => {
    useOnlineAuction.mockReturnValue({
      state: {
        connected: true,
        status: 'running',
        paused: false,
        currentPrice: 120,
        leadingTeamId: null,
        timerLeft: 10,
        bids: [],
        config: { timerEnabled: false, maxPlayersPerTeam: 11 },
        teams: [{ id: 'team1', name: 'Team 1', budget: 1000, players: [] }],
        players: [{ id: 'p1', name: 'Player 1', role: 'Batsman', basePrice: 100, status: 'pending', photoUrl: 'https://example.com/p1.jpg' }],
        queue: [0],
        currentIdx: 0,
        sessionError: null,
      },
      clearSessionError: clearSessionErrorMock,
      clearError: vi.fn(),
      captainBid: vi.fn(),
      currentPlayer: { id: 'p1', name: 'Player 1', role: 'Batsman', basePrice: 100, status: 'pending', photoUrl: 'https://example.com/p1.jpg' },
      leadingTeam: null,
    })

    render(<CaptainBidding />)

    expect(screen.getByRole('img', { name: /player 1 photo/i })).toBeInTheDocument()
  })
})
