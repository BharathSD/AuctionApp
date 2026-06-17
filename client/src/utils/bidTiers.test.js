import { describe, it, expect } from 'vitest'
import { getIncrement, minCostForRemainingSpots } from './bidTiers'

// ─── getIncrement ─────────────────────────────────────────────

describe('getIncrement', () => {
  describe('flat bidIncrement fallback (no bidTiers)', () => {
    it('returns configured flat increment', () => {
      expect(getIncrement(500, { bidIncrement: 50 })).toBe(50)
    })

    it('returns 0 when bidIncrement is missing', () => {
      expect(getIncrement(500, {})).toBe(0)
    })

    it('returns 0 when bidTiers is empty array', () => {
      expect(getIncrement(500, { bidTiers: [] })).toBe(0)
    })
  })

  describe('staged bid tiers', () => {
    const config = {
      bidTiers: [
        { upTo: 1000, increment: 100 },
        { upTo: 4000, increment: 200 },
        { upTo: null, increment: 500 },
      ],
    }

    it('uses first tier when price is below first upTo', () => {
      expect(getIncrement(0, config)).toBe(100)
      expect(getIncrement(999, config)).toBe(100)
    })

    it('moves to second tier at the upTo boundary', () => {
      expect(getIncrement(1000, config)).toBe(200)
      expect(getIncrement(3999, config)).toBe(200)
    })

    it('uses last tier (open-ended) above all thresholds', () => {
      expect(getIncrement(4000, config)).toBe(500)
      expect(getIncrement(99999, config)).toBe(500)
    })

    it('works with a single open-ended tier', () => {
      expect(getIncrement(0, { bidTiers: [{ upTo: null, increment: 10 }] })).toBe(10)
      expect(getIncrement(999999, { bidTiers: [{ upTo: null, increment: 10 }] })).toBe(10)
    })
  })
})

// ─── minCostForRemainingSpots ─────────────────────────────────

describe('minCostForRemainingSpots', () => {
  const pending = (basePrice) => ({ status: 'pending', basePrice })
  const unsold  = (basePrice) => ({ status: 'unsold',  basePrice })
  const sold    = (basePrice) => ({ status: 'sold',    basePrice })

  it('returns 0 when no spots needed', () => {
    const players = [pending(200), pending(300)]
    expect(minCostForRemainingSpots(players, 0, 0)).toBe(0)
  })

  it('returns 0 when spotsNeeded is negative', () => {
    const players = [pending(200), pending(300)]
    expect(minCostForRemainingSpots(players, 0, -1)).toBe(0)
  })

  it('sums the cheapest N available players (pending)', () => {
    // excludeIdx=0, spots=2 → cheapest 2 of [300, 400, 500] = 700
    const players = [pending(200), pending(300), pending(400), pending(500)]
    expect(minCostForRemainingSpots(players, 0, 2)).toBe(700)
  })

  it('sums the cheapest N available players (unsold included)', () => {
    // excludeIdx=0, spots=2 → cheapest 2 of [200(unsold), 300, 500] = 500
    const players = [pending(100), unsold(200), pending(300), pending(500)]
    expect(minCostForRemainingSpots(players, 0, 2)).toBe(500)
  })

  it('excludes sold players from the pool', () => {
    // excludeIdx=0, spots=1 → sold(100) is excluded, cheapest pending = 300
    const players = [pending(200), sold(100), pending(300)]
    expect(minCostForRemainingSpots(players, 0, 1)).toBe(300)
  })

  it('excludes the current on-block player by index', () => {
    // player at idx 0 has basePrice 200; should not be counted
    const players = [pending(200), pending(300), pending(400)]
    // spots=1 → cheapest available excluding idx0 = 300
    expect(minCostForRemainingSpots(players, 0, 1)).toBe(300)
  })

  it('returns sum of all available if fewer players than spots needed', () => {
    // Only 2 available (excluding block), need 5 → returns what is there
    const players = [pending(100), pending(200), pending(300)]
    expect(minCostForRemainingSpots(players, 0, 5)).toBe(500) // 200 + 300
  })

  it('returns 0 if no available players remain', () => {
    const players = [pending(200), sold(300)]
    // excludeIdx=0 removes the only pending player; only sold remain
    expect(minCostForRemainingSpots(players, 0, 2)).toBe(0)
  })

  it('handles string basePrices (CSV import edge case)', () => {
    const players = [pending('200'), pending('300'), pending('400')]
    expect(minCostForRemainingSpots(players, 0, 2)).toBe(700)
  })
})
