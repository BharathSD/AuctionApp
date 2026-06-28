// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import CaptainJoin from './CaptainJoin'

const navigateMock = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ roomCode: 'ROOM42' }),
}))

describe('CaptainJoin UX', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('shows a clear conflict message when team is already connected elsewhere', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'This team is already connected from another device.' }),
    })

    render(<CaptainJoin />)

    fireEvent.change(screen.getByPlaceholderText(/enter pin/i), { target: { value: '1111' } })
    fireEvent.click(screen.getByRole('button', { name: /join auction/i }))

    await waitFor(() => {
      expect(screen.getByText(/already connected on another device/i)).toBeInTheDocument()
    })
  })
})
