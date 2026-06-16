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
