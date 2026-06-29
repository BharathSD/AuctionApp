// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import PlayerAvatar from './PlayerAvatar'

afterEach(() => {
  cleanup()
})

describe('PlayerAvatar', () => {
  it('renders an image for valid http/https photo URLs', () => {
    render(<PlayerAvatar name="Player One" photoUrl="https://example.com/player-one.jpg" size="md" />)

    expect(screen.getByRole('img', { name: /player one photo/i })).toBeInTheDocument()
  })

  it('renders initials fallback when URL is missing', () => {
    render(<PlayerAvatar name="Virat Kohli" photoUrl={null} size="md" />)

    expect(screen.getByText('VK')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('falls back to initials when image load fails', () => {
    render(<PlayerAvatar name="Rohit Sharma" photoUrl="https://example.com/missing.jpg" size="md" />)

    const image = screen.getByRole('img', { name: /rohit sharma photo/i })
    fireEvent.error(image)

    expect(screen.getByText('RS')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /rohit sharma photo/i })).not.toBeInTheDocument()
  })
})
