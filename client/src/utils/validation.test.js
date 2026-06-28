import { describe, it, expect } from 'vitest'
import {
  validateNumeric,
  validatePositiveNumeric,
  validateNonNegative,
  validateTeamName,
  validateTeamPin,
  validatePlayerName,
  validateBasePrice,
  validateBidTierConfig,
  validateAuctionStartup,
  validateConfigValues,
} from './validation'

describe('validateNumeric', () => {
  it('accepts valid numbers in range', () => {
    expect(validateNumeric(5, 1, 10).valid).toBe(true)
  })

  it('rejects numbers below min', () => {
    const result = validateNumeric(-1, 0, 10)
    expect(result.valid).toBe(false)
  })

  it('rejects numbers above max', () => {
    const result = validateNumeric(11, 0, 10)
    expect(result.valid).toBe(false)
  })

  it('rejects non-numbers', () => {
    expect(validateNumeric('abc', 0, 10).valid).toBe(false)
  })
})

describe('validatePositiveNumeric', () => {
  it('accepts numbers >= 1', () => {
    expect(validatePositiveNumeric(1).valid).toBe(true)
    expect(validatePositiveNumeric(100).valid).toBe(true)
  })

  it('rejects 0', () => {
    expect(validatePositiveNumeric(0).valid).toBe(false)
  })

  it('rejects negatives', () => {
    expect(validatePositiveNumeric(-5).valid).toBe(false)
  })
})

describe('validateTeamName', () => {
  it('accepts valid team names', () => {
    expect(validateTeamName('Team A').valid).toBe(true)
  })

  it('rejects empty names', () => {
    expect(validateTeamName('').valid).toBe(false)
    expect(validateTeamName('   ').valid).toBe(false)
  })

  it('rejects names > 50 chars', () => {
    expect(validateTeamName('a'.repeat(51)).valid).toBe(false)
  })
})

describe('validatePlayerName', () => {
  it('accepts valid names', () => {
    expect(validatePlayerName('John Doe').valid).toBe(true)
  })

  it('rejects empty', () => {
    expect(validatePlayerName('').valid).toBe(false)
  })
})

describe('validateTeamPin', () => {
  it('accepts valid pins', () => {
    expect(validateTeamPin('1234').valid).toBe(true)
  })

  it('rejects empty pins', () => {
    expect(validateTeamPin('').valid).toBe(false)
    expect(validateTeamPin('   ').valid).toBe(false)
  })

  it('rejects pins longer than 8 chars', () => {
    expect(validateTeamPin('123456789').valid).toBe(false)
  })
})

describe('validateBasePrice', () => {
  it('accepts prices >= minBidBase', () => {
    expect(validateBasePrice(100, 10).valid).toBe(true)
  })

  it('rejects prices < minBidBase', () => {
    expect(validateBasePrice(5, 10).valid).toBe(false)
  })

  it('rejects negative prices', () => {
    expect(validateBasePrice(-100, 0).valid).toBe(false)
  })
})

describe('validateBidTierConfig', () => {
  it('accepts valid tier config', () => {
    const result = validateBidTierConfig([
      { upTo: 1000, increment: 100 },
      { upTo: null, increment: 500 },
    ])
    expect(result.valid).toBe(true)
  })

  it('rejects config without open-ended tier', () => {
    const result = validateBidTierConfig([
      { upTo: 1000, increment: 100 },
      { upTo: 5000, increment: 200 },
    ])
    expect(result.valid).toBe(false)
  })

  it('rejects backward upTo values', () => {
    const result = validateBidTierConfig([
      { upTo: 5000, increment: 200 },
      { upTo: 1000, increment: 100 },
      { upTo: null, increment: 500 },
    ])
    expect(result.valid).toBe(false)
  })

  it('rejects open-ended tier not at end', () => {
    const result = validateBidTierConfig([
      { upTo: null, increment: 100 },
      { upTo: 1000, increment: 200 },
    ])
    expect(result.valid).toBe(false)
  })

  it('accepts single open-ended tier', () => {
    const result = validateBidTierConfig([{ upTo: null, increment: 10 }])
    expect(result.valid).toBe(true)
  })
})

describe('validateAuctionStartup', () => {
  const defaultConfig = {
    numTeams: 2,
    pointsPerTeam: 1000,
    maxPlayersPerTeam: 11,
    bidTiers: [{ upTo: null, increment: 10 }],
    timerEnabled: false,
  }
  const teams = [
    { id: 't1', name: 'Team 1', pin: '1111' },
    { id: 't2', name: 'Team 2', pin: '2222' },
  ]
  const players = [
    { id: 'p1', name: 'Player 1', basePrice: 100 },
  ]

  it('accepts valid startup', () => {
    const result = validateAuctionStartup(defaultConfig, teams, players, [])
    expect(result.valid).toBe(true)
  })

  it('rejects zero teams', () => {
    const result = validateAuctionStartup(defaultConfig, [], players, [])
    expect(result.valid).toBe(false)
  })

  it('rejects zero players', () => {
    const result = validateAuctionStartup(defaultConfig, teams, [], [])
    expect(result.valid).toBe(false)
  })

  it('rejects pre-allocation exceeding team budget', () => {
    const preAllocs = [{ teamId: 't1', playerId: 'p1', price: 1500 }]
    const result = validateAuctionStartup(defaultConfig, teams, players, preAllocs)
    expect(result.valid).toBe(false)
  })

  it('accepts pre-allocation within budget', () => {
    const preAllocs = [{ teamId: 't1', playerId: 'p1', price: 500 }]
    const result = validateAuctionStartup(defaultConfig, teams, players, preAllocs)
    expect(result.valid).toBe(true)
  })

  it('rejects duplicate team names', () => {
    const dupTeams = [
      { id: 't1', name: 'Knights', pin: '1111' },
      { id: 't2', name: 'Knights', pin: '2222' },
    ]
    const result = validateAuctionStartup(defaultConfig, dupTeams, players, [])
    expect(result.valid).toBe(false)
  })

  it('rejects duplicate team PINs', () => {
    const dupPins = [
      { id: 't1', name: 'Team 1', pin: '1111' },
      { id: 't2', name: 'Team 2', pin: '1111' },
    ]
    const result = validateAuctionStartup(defaultConfig, dupPins, players, [])
    expect(result.valid).toBe(false)
  })
})

describe('validateConfigValues', () => {
  it('accepts valid config', () => {
    const config = {
      numTeams: 4,
      pointsPerTeam: 1000,
      minBidBase: 10,
      maxPlayersPerTeam: 11,
      timerEnabled: false,
      bidTiers: [{ upTo: null, increment: 10 }],
    }
    const result = validateConfigValues(config)
    expect(result.valid).toBe(true)
  })

  it('rejects zero teams', () => {
    const config = {
      numTeams: 0,
      pointsPerTeam: 1000,
      minBidBase: 10,
      maxPlayersPerTeam: 11,
      timerEnabled: false,
      bidTiers: [{ upTo: null, increment: 10 }],
    }
    const result = validateConfigValues(config)
    expect(result.valid).toBe(false)
  })

  it('rejects zero budget', () => {
    const config = {
      numTeams: 4,
      pointsPerTeam: 0,
      minBidBase: 10,
      maxPlayersPerTeam: 11,
      timerEnabled: false,
      bidTiers: [{ upTo: null, increment: 10 }],
    }
    const result = validateConfigValues(config)
    expect(result.valid).toBe(false)
  })

  it('rejects invalid timer seconds', () => {
    const config = {
      numTeams: 4,
      pointsPerTeam: 1000,
      minBidBase: 10,
      maxPlayersPerTeam: 11,
      timerEnabled: true,
      timerSeconds: 2, // min is 5
      bidTiers: [{ upTo: null, increment: 10 }],
    }
    const result = validateConfigValues(config)
    expect(result.valid).toBe(false)
  })
})
