/**
 * Staged bid increment logic.
 *
 * config.bidTiers = [{ upTo: 1000, increment: 100 }, { upTo: 4000, increment: 200 }, { upTo: null, increment: 500 }]
 * upTo is exclusive: price >= upTo moves to the next tier.
 *
 * Backward compat: if bidTiers is absent, falls back to flat config.bidIncrement.
 */
export function getIncrement(currentPrice, config) {
  const tiers = config.bidTiers
  if (!tiers || tiers.length === 0) return Number(config.bidIncrement) || 0
  const tier = tiers.find(t => t.upTo === null || t.upTo === undefined || currentPrice < Number(t.upTo))
  return Number(tier?.increment ?? tiers[tiers.length - 1].increment ?? 0)
}

export const DEFAULT_BID_TIERS = [{ upTo: null, increment: 10 }]

/**
 * Returns the minimum budget needed to fill `spotsNeeded` more roster spots
 * after the current player is won, using the cheapest still-available players'
 * base prices. Excludes the player currently on the block (by array index).
 *
 * Example: spots needed = 2, available base prices = [200, 300, 300, 500]
 *   → returns 200 + 300 = 500
 */
export function minCostForRemainingSpots(players, excludeIdx, spotsNeeded) {
  if (spotsNeeded <= 0) return 0
  const prices = players
    .filter((p, i) => i !== excludeIdx && (p.status === 'pending' || p.status === 'unsold'))
    .map(p => Number(p.basePrice) || 0)
    .sort((a, b) => a - b)
  return prices.slice(0, spotsNeeded).reduce((sum, v) => sum + v, 0)
}
