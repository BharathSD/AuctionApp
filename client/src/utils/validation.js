/**
 * Input validation utilities for auction setup
 */

export function validateNumeric(value, min = 0, max = Infinity, name = 'Value') {
  const num = Number(value)
  if (isNaN(num)) return { valid: false, error: `${name} must be a number` }
  if (num < min) return { valid: false, error: `${name} must be >= ${min}` }
  if (num > max) return { valid: false, error: `${name} must be <= ${max}` }
  return { valid: true, value: num }
}

export function validatePositiveNumeric(value, name = 'Value') {
  return validateNumeric(value, 1, Infinity, name)
}

export function validateNonNegative(value, name = 'Value') {
  return validateNumeric(value, 0, Infinity, name)
}

export function validateTeamName(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return { valid: false, error: 'Team name cannot be empty' }
  if (trimmed.length > 50) return { valid: false, error: 'Team name too long (max 50 chars)' }
  return { valid: true, value: trimmed }
}

export function validateTeamPin(pin) {
  const trimmed = String(pin || '').trim()
  if (!trimmed) return { valid: false, error: 'Team PIN cannot be empty' }
  if (trimmed.length > 8) return { valid: false, error: 'Team PIN too long (max 8 chars)' }
  return { valid: true, value: trimmed }
}

export function validatePlayerName(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return { valid: false, error: 'Player name cannot be empty' }
  if (trimmed.length > 50) return { valid: false, error: 'Player name too long (max 50 chars)' }
  return { valid: true, value: trimmed }
}

export function validateBasePrice(price, minBidBase = 0) {
  const val = validateNonNegative(price, 'Base price')
  if (!val.valid) return val
  if (val.value < minBidBase) {
    return { valid: false, error: `Base price must be >= minimum bid base (${minBidBase})` }
  }
  return { valid: true, value: val.value }
}

export function validateBidTierConfig(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { valid: false, error: 'Must have at least one bid tier' }
  }
  
  let hasOpenEnded = false
  let previousUpTo = -1
  
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]
    
    // Check increment is positive
    const incVal = validatePositiveNumeric(tier.increment, `Tier ${i + 1} increment`)
    if (!incVal.valid) return incVal
    
    // Check upTo values are ascending
    if (tier.upTo === null || tier.upTo === undefined) {
      hasOpenEnded = true
      if (i !== tiers.length - 1) {
        return { valid: false, error: `Open-ended tier must be last (tier ${i + 1})` }
      }
    } else {
      const upToVal = validatePositiveNumeric(tier.upTo, `Tier ${i + 1} upTo`)
      if (!upToVal.valid) return upToVal
      if (upToVal.value <= previousUpTo) {
        return { valid: false, error: `Tier ${i + 1} upTo (${upToVal.value}) must be > previous (${previousUpTo})` }
      }
      previousUpTo = upToVal.value
    }
  }
  
  if (!hasOpenEnded) {
    return { valid: false, error: 'Must have one open-ended tier (upTo: ∞)' }
  }
  
  return { valid: true }
}

export function validateAuctionStartup(config, teams, players, preAllocations) {
  // Must have at least 1 team
  if (!teams || teams.length === 0) {
    return { valid: false, error: 'Must create at least 1 team' }
  }

  // Must have at least 1 player (pending or pre-allocated)
  if (!players || players.length === 0) {
    return { valid: false, error: 'Must add at least 1 player' }
  }

  // numTeams must match actual teams
  if (config.numTeams !== teams.length) {
    return { valid: false, error: `Team count mismatch: expected ${config.numTeams}, have ${teams.length}` }
  }

  // Team names must be valid and unique
  const teamNames = new Set()
  for (const team of teams) {
    const nameVal = validateTeamName(team.name)
    if (!nameVal.valid) return { valid: false, error: `Team "${team.name || 'Unknown'}": ${nameVal.error}` }
    const key = nameVal.value.toLowerCase()
    if (teamNames.has(key)) return { valid: false, error: `Duplicate team name: "${nameVal.value}"` }
    teamNames.add(key)
  }

  // Team PINs must be valid and unique
  const teamPins = new Set()
  for (const team of teams) {
    const pinVal = validateTeamPin(team.pin)
    if (!pinVal.valid) return { valid: false, error: `Team "${team.name}": ${pinVal.error}` }
    if (teamPins.has(pinVal.value)) return { valid: false, error: `Duplicate team PIN: "${pinVal.value}"` }
    teamPins.add(pinVal.value)
  }

  // Draft mode has no budget concept — skip the pre-allocation-vs-budget check below.
  if (config.engine === 'draft') return { valid: true }

  // Check each team has valid budget after pre-allocation
  for (const team of teams) {
    const myAllocs = (preAllocations || []).filter(a => a.teamId === team.id)
    const spent = myAllocs.reduce((s, a) => s + Number(a.price || 0), 0)
    const remaining = config.pointsPerTeam - spent

    if (remaining < 0) {
      return { valid: false, error: `Team "${team.name}" pre-allocation (${spent} pts) exceeds budget (${config.pointsPerTeam} pts)` }
    }
  }

  return { valid: true }
}

export function validateConfigValues(config) {
  const numTeamsVal = validateNumeric(config.numTeams, 1, 16, 'Number of teams')
  if (!numTeamsVal.valid) return numTeamsVal

  const maxPlayersVal = validatePositiveNumeric(config.maxPlayersPerTeam, 'Max players per team')
  if (!maxPlayersVal.valid) return maxPlayersVal

  if (config.timerEnabled) {
    const timerVal = validateNumeric(config.timerSeconds, 5, 120, 'Timer seconds')
    if (!timerVal.valid) return timerVal
  }

  // Draft mode has no budget/bid-tier concept — nothing further to validate.
  if (config.engine === 'draft') return { valid: true }

  const budgetVal = validatePositiveNumeric(config.pointsPerTeam, 'Points per team')
  if (!budgetVal.valid) return budgetVal

  const minBidVal = validateNonNegative(config.minBidBase, 'Minimum base bid')
  if (!minBidVal.valid) return minBidVal

  // Validate bid tiers
  const tierVal = validateBidTierConfig(config.bidTiers || [])
  if (!tierVal.valid) return tierVal

  return { valid: true }
}

/**
 * Non-blocking quality warnings for an imported/assembled player roster.
 * These never reject data — they only surface things a host may want to fix
 * (duplicate names, placeholder/blank roles) before starting the auction.
 * @param {Array<{name?: string, role?: string}>} players
 * @returns {string[]} human-readable warning messages (empty if all clean)
 */
export function getPlayerImportWarnings(players) {
  const warnings = []
  if (!Array.isArray(players) || !players.length) return warnings

  // Duplicate names (case-insensitive)
  const seen = new Map()
  const dupNames = new Set()
  for (const p of players) {
    const display = String(p?.name || '').trim()
    if (!display) continue
    const key = display.toLowerCase()
    if (seen.has(key)) dupNames.add(seen.get(key))
    else seen.set(key, display)
  }
  if (dupNames.size) {
    const sample = [...dupNames].slice(0, 3).join(', ')
    const more = dupNames.size > 3 ? '…' : ''
    warnings.push(
      `${dupNames.size} duplicate name${dupNames.size > 1 ? 's' : ''} (${sample}${more}) — imported as separate players; rename if they are different people.`
    )
  }

  // Placeholder or blank roles
  const genericRoles = players.filter(p => {
    const r = String(p?.role || '').trim().toLowerCase()
    return !r || r === 'player'
  }).length
  if (genericRoles) {
    warnings.push(
      `${genericRoles} player${genericRoles > 1 ? 's' : ''} have a generic or blank role — set a real role for clearer team sheets.`
    )
  }

  return warnings
}
