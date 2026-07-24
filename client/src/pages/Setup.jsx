import { useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Papa from 'papaparse'
import { saveAuctionConfig } from '../hooks/useAuctionStorage'
import { DEFAULT_BID_TIERS } from '../utils/bidTiers'
import { validateConfigValues, validatePlayerName, validateBasePrice, validateAuctionStartup, getPlayerImportWarnings } from '../utils/validation'
import PlayerAvatar from '../components/PlayerAvatar'
import Icon from '../components/Icon'
import BrandMark from '../components/BrandMark'

const DEFAULT_CONFIG = {
  engine: 'bidding', // 'bidding' | 'draft'
  numTeams: 4,
  pointsPerTeam: 10000,
  bidTiers: [{ upTo: null, increment: 100 }],
  timerEnabled: true,
  timerSeconds: 15,
  minBidBase: 100,
  maxPlayersPerTeam: 11,
  randomizeOrder: false,
}

const ROLE_OPTIONS = [
  { value: 'Super Striker', label: 'Super Striker' },
  { value: 'All Rounder', label: 'All Rounder' },
  { value: 'Batsman', label: 'Batsman' },
  { value: 'Bowler', label: 'Bowler' },
  { value: 'Wicket-keeper', label: 'Wicket Keeper' },
]

export default function Setup() {
  const { mode } = useParams()
  const navigate = useNavigate()
  const [step, setStep] = useState('config') // config | teams | players | review
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [teams, setTeams] = useState(() =>
    Array.from({ length: DEFAULT_CONFIG.numTeams }, (_, i) => ({
      id: `team-${i}`,
      name: `Team ${i + 1}`,
      pin: String(1000 + i),
    }))
  )
  const [players, setPlayers] = useState([])
  const [newPlayer, setNewPlayer] = useState({ name: '', role: 'Batsman', basePrice: '', photoUrl: '' })
  const [editingPlayerId, setEditingPlayerId] = useState(null)
  const [csvError, setCsvError] = useState('')
  const [csvWarnings, setCsvWarnings] = useState([])
  const [preAllocations, setPreAllocations] = useState([]) // [{playerId, teamId, price}]
  const [retainSearch, setRetainSearch] = useState('')
  const [playerSearch, setPlayerSearch] = useState('')
  const [playerRoleFilter, setPlayerRoleFilter] = useState([])
  const [playerRoleSearch, setPlayerRoleSearch] = useState('')
  const fileRef = useRef()

  const normalizePhotoUrl = (rawValue) => {
    const value = String(rawValue || '').trim()
    if (!value) return null
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
      return parsed.toString()
    } catch {
      return null
    }
  }

  /* ---------- bid tier helpers ---------- */
  const tiers = config.bidTiers || DEFAULT_BID_TIERS
  const updateTier = (idx, field, value) => {
    const next = tiers.map((t, i) => i === idx ? { ...t, [field]: field === 'upTo' ? (value === '' ? null : Number(value)) : Number(value) } : t)
    setConfig(prev => ({ ...prev, bidTiers: next }))
  }
  const addTier = () => {
    // Insert before the last (unlimited) tier
    const last = tiers[tiers.length - 1]
    const newTier = { upTo: null, increment: last.increment }
    const prev = tiers.slice(0, -1)
    // Give the last bounded row a default upTo
    const lastBounded = prev.length > 0 ? prev[prev.length - 1] : null
    const defaultUpTo = lastBounded?.upTo ? lastBounded.upTo * 2 : 1000
    setConfig(c => ({ ...c, bidTiers: [...prev, { upTo: defaultUpTo, increment: last.increment }, newTier] }))
  }
  const removeTier = (idx) => {
    if (tiers.length <= 1) return // must keep at least one
    const next = tiers.filter((_, i) => i !== idx)
    // Ensure last tier has upTo = null
    next[next.length - 1] = { ...next[next.length - 1], upTo: null }
    setConfig(prev => ({ ...prev, bidTiers: next }))
  }

  const handleConfigChange = (field, value) => {
    const stringFields = field === 'timerEnabled' || field === 'randomizeOrder' || field === 'engine'
    const parsed = stringFields ? value : Number(value) || value
    setConfig(prev => ({ ...prev, [field]: parsed }))
    if (field === 'numTeams') {
      const n = Number(value) || 2
      setTeams(Array.from({ length: n }, (_, i) => ({
        id: `team-${i}`,
        name: teams[i]?.name || `Team ${i + 1}`,
        pin: teams[i]?.pin || String(1000 + i),
      })))
    }
  }

  const upsertPlayer = () => {
    // Validate player name and price
    const nameVal = validatePlayerName(newPlayer.name)
    if (!nameVal.valid) { alert(nameVal.error); return }
    
    const priceVal = validateBasePrice(newPlayer.basePrice, config.minBidBase)
    if (!priceVal.valid) { alert(priceVal.error); return }
    
    const photoUrl = normalizePhotoUrl(newPlayer.photoUrl)
    setPlayers(prev => {
      const next = editingPlayerId
        ? prev.map(p => p.id === editingPlayerId
          ? { ...p, name: nameVal.value, role: newPlayer.role, basePrice: priceVal.value, photoUrl }
          : p)
        : [...prev, { id: `p-${Date.now()}`, name: nameVal.value, role: newPlayer.role, basePrice: priceVal.value, photoUrl }]
      setCsvWarnings(getPlayerImportWarnings(next))
      return next
    })
    setEditingPlayerId(null)
    setNewPlayer({ name: '', role: 'Batsman', basePrice: '', photoUrl: '' })
  }

  const startEditPlayer = (player) => {
    setEditingPlayerId(player.id)
    setNewPlayer({
      name: player.name || '',
      role: player.role || 'Batsman',
      basePrice: String(player.basePrice ?? ''),
      photoUrl: player.photoUrl || '',
    })
  }

  const cancelEditPlayer = () => {
    setEditingPlayerId(null)
    setNewPlayer({ name: '', role: 'Batsman', basePrice: '', photoUrl: '' })
  }

  const removePlayer = (id) => {
    setPlayers(prev => {
      const next = prev.filter(p => p.id !== id)
      setCsvWarnings(getPlayerImportWarnings(next))
      return next
    })
    if (editingPlayerId === id) cancelEditPlayer()
  }

  const handleCSV = (e) => {
    setCsvError('')
    setCsvWarnings([])
    const file = e.target.files[0]
    if (!file) return
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        const parsed = data.map((row, i) => {
          const name = row.name || row.Name || row.player || row.Player
          const role = row.role || row.Role || 'Batsman'
          const basePrice = Number(row.basePrice || row.base_price || row['Base Price'] || config.minBidBase)
          const photoRaw = row.photoUrl || row.photo_url || row.photo || row.image || row.imageUrl || row.avatar || row['Photo URL'] || row['Image URL'] || ''
          
          // Validate player name
          const nameVal = validatePlayerName(name)
          if (!nameVal.valid) return null
          
          // Validate base price
          const priceVal = validateBasePrice(basePrice, config.minBidBase)
          if (!priceVal.valid) { setCsvError(`Row ${i + 1}: ${priceVal.error}`); return null }
          
          return { id: `csv-${i}-${Date.now()}`, name: nameVal.value, role: role.trim(), basePrice: priceVal.value, photoUrl: normalizePhotoUrl(photoRaw) }
        }).filter(Boolean)
        if (!parsed.length) { setCsvError('No valid rows found. Ensure columns: name, role, basePrice (photoUrl optional)'); return }
        const skipped = data.length - parsed.length
        setPlayers(prev => {
          const combined = [...prev, ...parsed]
          const warnings = getPlayerImportWarnings(combined)
          if (skipped > 0) warnings.unshift(`${skipped} row${skipped > 1 ? 's' : ''} skipped (missing or invalid name).`)
          setCsvWarnings(warnings)
          return combined
        })
      },
      error: () => setCsvError('Failed to parse CSV.'),
    })
    fileRef.current.value = ''
  }

  const handleStart = () => {
    // Validate config values
    const configVal = validateConfigValues(config)
    if (!configVal.valid) { alert(`Config error: ${configVal.error}`); return }
    
    // Validate auction startup conditions
    const startupVal = validateAuctionStartup(config, teams, players, preAllocations)
    if (!startupVal.valid) { alert(`Cannot start: ${startupVal.error}`); return }
    
    if (!players.length) return
    const isDraft = config.engine === 'draft'
    const auctionData = {
      mode,
      config,
      teams: teams.map(t => {
        const myAllocs = preAllocations.filter(a => a.teamId === t.id)
        const prePlayers = myAllocs.map(a => {
          const p = players.find(pl => pl.id === a.playerId)
          if (!p) return null
          return isDraft
            ? { ...p, status: 'sold', soldTo: t.id }
            : { ...p, soldPrice: Number(a.price), status: 'sold', soldTo: t.id }
        }).filter(Boolean)
        if (isDraft) return { ...t, players: prePlayers }
        const spent = myAllocs.reduce((s, a) => s + Number(a.price), 0)
        return { ...t, budget: config.pointsPerTeam - spent, spent, players: prePlayers }
      }),
      players: players.map(p => {
        const alloc = preAllocations.find(a => a.playerId === p.id)
        if (alloc) {
          return isDraft
            ? { ...p, status: 'sold', soldTo: alloc.teamId }
            : { ...p, status: 'sold', soldTo: alloc.teamId, soldPrice: Number(alloc.price) }
        }
        return { ...p, status: 'pending', soldTo: null, soldPrice: null }
      }),
      roomCode: mode === 'online' ? Math.random().toString(36).slice(2, 8).toUpperCase() : null,
      createdAt: Date.now(),
    }
    
    if (mode === 'offline') {
      saveAuctionConfig(auctionData)
      navigate('/auction/offline')
    } else {
      // Online mode: create room via API and get adminToken
      fetch('/api/auction/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: auctionData.roomCode, auctionData }),
      })
        .then(r => {
          if (!r.ok) throw new Error('Failed to create room')
          return r.json()
        })
        .then(({ adminToken }) => {
          // Store auction data with admin token
          auctionData.adminToken = adminToken
          saveAuctionConfig(auctionData)
          navigate('/auction/online/admin')
        })
        .catch(err => {
          console.error('Create room failed:', err)
          alert('Failed to create auction room: ' + err.message)
        })
    }
  }

  const roleOrder = ROLE_OPTIONS.reduce((acc, role, idx) => ({ ...acc, [role.value]: idx }), {})
  const roleUsageCounts = players.reduce((acc, p) => {
    const role = String(p.role || '').trim()
    if (!role) return acc
    acc[role] = (acc[role] || 0) + 1
    return acc
  }, {})
  const roleFilterOptions = [...new Set([...ROLE_OPTIONS.map(r => r.value), ...players.map(p => p.role).filter(Boolean)])]
    .sort((a, b) => {
      const usageDiff = (roleUsageCounts[b] || 0) - (roleUsageCounts[a] || 0)
      if (usageDiff !== 0) return usageDiff
      const orderA = roleOrder[a] ?? Number.MAX_SAFE_INTEGER
      const orderB = roleOrder[b] ?? Number.MAX_SAFE_INTEGER
      if (orderA !== orderB) return orderA - orderB
      return a.localeCompare(b)
    })
  const visibleRoleOptions = roleFilterOptions.filter(role =>
    role.toLowerCase().includes(playerRoleSearch.trim().toLowerCase())
  )
  const toggleRoleFilter = (role) => {
    setPlayerRoleFilter(prev => prev.includes(role)
      ? prev.filter(r => r !== role)
      : [...prev, role])
  }
  const filteredPlayers = players.filter((p) => {
    const matchesSearch = !playerSearch.trim()
      || p.name.toLowerCase().includes(playerSearch.trim().toLowerCase())
      || p.role.toLowerCase().includes(playerSearch.trim().toLowerCase())
    const matchesRole = playerRoleFilter.length === 0 || playerRoleFilter.includes(p.role)
    return matchesSearch && matchesRole
  })

  /* ---------- draft category order (Round Robin only) ---------- */
  // Present categories (distinct roles in the current player list), merged
  // with any previously-arranged order: keeps prior ordering, appends newly
  // added categories at the end, drops ones that no longer have players.
  const presentCategories = [...new Set(players.map(p => p.role).filter(Boolean))]
  const savedCategoryOrder = config.categoryOrder || []
  const categoryOrder = [
    ...savedCategoryOrder.filter(c => presentCategories.includes(c)),
    ...presentCategories.filter(c => !savedCategoryOrder.includes(c)),
  ]
  const moveCategory = (idx, dir) => {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= categoryOrder.length) return
    const next = [...categoryOrder]
    ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    setConfig(prev => ({ ...prev, categoryOrder: next }))
  }

  /* ---------- render ---------- */
  return (
    <div className="app-shell text-white">
      <div className="app-page setup-form max-w-3xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white text-sm inline-flex items-center gap-1.5">← Back to home</button>
            <BrandMark size={28} withWordmark wordmark="Auction OS" />
          </div>
          <p className="hero-kicker mb-2">{mode === 'offline' ? 'Single-console setup' : 'Multi-device setup'}</p>
          <h1 className="page-title">
            {mode === 'offline' ? 'Offline' : 'Online'} {config.engine === 'draft' ? 'Draft' : 'Auction'} Setup
          </h1>
        </div>

        {/* Step tabs */}
        <div className="flex gap-1 mb-8 auction-surface rounded-xl p-1">
          {[
            ['config', 'Configuration'],
            ['teams', 'Teams'],
            ['players', 'Players'],
            ...(config.engine === 'draft' ? [['categories', 'Categories']] : []),
            ['preallocate', 'Retentions'],
            ['review', 'Review'],
          ].map(([s, label]) => (
            <button
              key={s}
              onClick={() => setStep(s)}
              aria-selected={step === s}
              className={`tab-chip flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${step === s ? 'text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* --- Step: Config --- */}
        {step === 'config' && (
          <div className="space-y-6">
            <Field label="Selection Engine">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
                {[
                  ['bidding', 'Competitive Bidding', 'Teams bid against a budget; highest bid wins each player.'],
                  ['draft', 'Round Robin Draft', 'No budget — teams take turns picking players, one category at a time.'],
                ].map(([value, label, desc]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleConfigChange('engine', value)}
                    aria-pressed={config.engine === value}
                    className={`text-left rounded-xl p-4 border transition-colors ${config.engine === value ? 'border-blue-500 bg-blue-900/30' : 'border-gray-800 auction-surface hover:border-gray-600'}`}
                  >
                    <p className="text-sm font-semibold text-white mb-1">{label}</p>
                    <p className="text-xs text-gray-400">{desc}</p>
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              <Field label="Number of Teams">
                <input type="number" min={2} max={16} value={config.numTeams}
                  onChange={e => handleConfigChange('numTeams', e.target.value)}
                  className="input-field max-w-[220px]" />
              </Field>
              {config.engine !== 'draft' && (
                <Field label="Points per Team (budget)">
                  <input type="number" min={100} value={config.pointsPerTeam}
                    onChange={e => handleConfigChange('pointsPerTeam', e.target.value)}
                    className="input-field max-w-[220px]" />
                </Field>
              )}
              {config.engine !== 'draft' && (
                <Field label="Minimum Base Bid">
                  <input type="number" min={1} value={config.minBidBase}
                    onChange={e => handleConfigChange('minBidBase', e.target.value)}
                    className="input-field max-w-[220px]" />
                </Field>
              )}
              <Field label="Max Players per Team">
                <input type="number" min={1} max={50} value={config.maxPlayersPerTeam}
                  onChange={e => handleConfigChange('maxPlayersPerTeam', e.target.value)}
                  className="input-field max-w-[220px]" />
              </Field>
            </div>
            {config.engine !== 'draft' && (
              <Field label="Bid Increment Tiers">
                <div className="space-y-2">
                  {tiers.map((tier, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-16 shrink-0">
                        {idx === 0 ? 'From 0' : `From ${tiers[idx - 1].upTo}`}
                      </span>
                      <span className="text-xs text-gray-500">to</span>
                      {tier.upTo === null ? (
                        <span className="text-xs text-gray-400 w-20 text-center">∞</span>
                      ) : (
                        <input
                          type="number" min={1} value={tier.upTo ?? ''}
                          onChange={e => updateTier(idx, 'upTo', e.target.value)}
                          className="input-field w-20 max-w-[5rem] text-center text-sm py-1"
                          placeholder="Up to"
                        />
                      )}
                      <span className="text-xs text-gray-500">→ +</span>
                      <input
                        type="number" min={1} value={tier.increment}
                        onChange={e => updateTier(idx, 'increment', e.target.value)}
                        className="input-field w-20 max-w-[5rem] text-center text-sm py-1"
                        placeholder="Inc"
                      />
                      <span className="text-xs text-gray-500">pts</span>
                      {tiers.length > 1 && (
                        <button onClick={() => removeTier(idx)} aria-label="Remove tier" className="text-red-400 hover:text-red-300 px-1"><Icon name="x" size={14} /></button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={addTier}
                    className="text-blue-400 hover:text-blue-300 text-xs mt-1"
                  >+ Add tier</button>
                </div>
              </Field>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              {config.engine !== 'draft' && (
                <Field label="Player Order">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={config.randomizeOrder}
                      onChange={e => handleConfigChange('randomizeOrder', e.target.checked)}
                      className="w-5 h-5 rounded" />
                    <span className="text-sm text-gray-300">Randomize player auction order</span>
                  </label>
                </Field>
              )}
              <Field label="Timer Mode">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={config.timerEnabled}
                    onChange={e => handleConfigChange('timerEnabled', e.target.checked)}
                    className="w-5 h-5 rounded" />
                  <span className="text-sm text-gray-300">
                    {config.engine === 'draft' ? 'Enable countdown timer per turn' : 'Enable countdown timer per bid'}
                  </span>
                </label>
              </Field>
            </div>
            {config.engine === 'draft' && (
              <p className="text-xs text-gray-500 -mt-3">
                Categories are the player <code>role</code> values in your player list — you'll set the draft order for them in the Categories step. Team pick order is randomized by the admin from the draft console, right before starting.
              </p>
            )}
            {config.timerEnabled && (
              <Field label={config.engine === 'draft' ? 'Turn Duration (seconds)' : 'Timer Duration (seconds)'}>
                <input type="number" min={5} max={120} value={config.timerSeconds}
                  onChange={e => handleConfigChange('timerSeconds', e.target.value)}
                  className="input-field max-w-[220px]" />
              </Field>
            )}
            <div className="flex justify-end">
              <button onClick={() => setStep('teams')} className="btn-primary">Next: Teams →</button>
            </div>
          </div>
        )}

        {/* --- Step: Teams --- */}
        {step === 'teams' && (
          <div className="space-y-4">
            {teams.map((team, i) => (
              <div key={team.id} className="auction-surface rounded-xl p-4 flex gap-4 items-center">
                <span className="text-gray-500 text-sm w-6">{i + 1}</span>
                <div className="flex-1">
                  <label className="text-xs text-gray-400 mb-1 block">Team Name</label>
                  <input
                    value={team.name}
                    onChange={e => setTeams(prev => prev.map((t, j) => j === i ? { ...t, name: e.target.value } : t))}
                    className="input-field"
                    placeholder={`Team ${i + 1}`}
                  />
                </div>
                {mode === 'online' && (
                  <div className="w-32">
                    <label className="text-xs text-gray-400 mb-1 block">PIN</label>
                    <input
                      value={team.pin}
                      onChange={e => setTeams(prev => prev.map((t, j) => j === i ? { ...t, pin: e.target.value } : t))}
                      className="input-field"
                      placeholder="PIN"
                      maxLength={8}
                    />
                  </div>
                )}
              </div>
            ))}
            <div className="flex justify-between mt-4">
              <button onClick={() => setStep('config')} className="btn-secondary">← Back</button>
              <button onClick={() => setStep('players')} className="btn-primary">Next: Players →</button>
            </div>
          </div>
        )}

        {/* --- Step: Players --- */}
        {step === 'players' && (
          <div className="space-y-6">
            {/* CSV Upload */}
            <div className="auction-surface rounded-xl p-4">
              <p className="text-sm font-semibold mb-2 text-gray-300">Import from CSV</p>
              <p className="text-xs text-gray-500 mb-3">Columns: <code>name, role, basePrice</code> and optional <code>photoUrl</code></p>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV}
                className="text-sm text-gray-300 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-blue-700 file:text-white file:cursor-pointer hover:file:bg-blue-600" />
              {csvError && <p className="text-red-400 text-xs mt-2">{csvError}</p>}
              {csvWarnings.length > 0 && (
                <ul className="mt-2 space-y-1" role="status">
                  {csvWarnings.map((w, i) => (
                    <li key={i} className="text-amber-400 text-xs flex gap-1.5">
                      <span aria-hidden="true">⚠</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Manual Add */}
            <div className="auction-surface rounded-xl p-4">
              <p className="text-sm font-semibold mb-3 text-gray-300">{editingPlayerId ? 'Edit Player' : 'Add Player Manually'}</p>
              <div className="flex gap-3 flex-wrap">
                <input value={newPlayer.name} onChange={e => setNewPlayer(p => ({ ...p, name: e.target.value }))}
                  placeholder="Player name" className="input-field flex-1 min-w-36" />
                <select value={newPlayer.role} onChange={e => setNewPlayer(p => ({ ...p, role: e.target.value }))}
                  className="input-field w-36">
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role.value} value={role.value}>{role.label}</option>
                  ))}
                </select>
                <input type="number" value={newPlayer.basePrice} onChange={e => setNewPlayer(p => ({ ...p, basePrice: e.target.value }))}
                  placeholder="Base price" className="input-field w-32" min={1} />
                <button onClick={upsertPlayer} className="btn-primary">{editingPlayerId ? 'Update' : 'Add'}</button>
                {editingPlayerId && (
                  <button onClick={cancelEditPlayer} className="btn-secondary">Cancel</button>
                )}
              </div>
              <div className="mt-3">
                <input value={newPlayer.photoUrl} onChange={e => setNewPlayer(p => ({ ...p, photoUrl: e.target.value }))}
                  placeholder="Photo URL (optional)" className="input-field" />
              </div>
            </div>

            {/* Player list */}
            {players.length > 0 && (
              <div className="auction-surface rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800 grid grid-cols-1 sm:grid-cols-[1fr_280px] gap-2">
                  <input
                    value={playerSearch}
                    onChange={(e) => setPlayerSearch(e.target.value)}
                    placeholder="Search players by name or role"
                    className="input-field"
                  />
                  <div className="auction-surface-soft rounded-lg p-2">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs text-gray-400">Role filters ({playerRoleFilter.length || 'All'})</span>
                      {playerRoleFilter.length > 0 && (
                        <button
                          onClick={() => setPlayerRoleFilter([])}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <input
                      value={playerRoleSearch}
                      onChange={(e) => setPlayerRoleSearch(e.target.value)}
                      placeholder="Search roles"
                      className="input-field text-xs py-1 mb-2"
                    />
                    <div className="max-h-24 overflow-y-auto space-y-1">
                      {visibleRoleOptions.map((role) => (
                        <label key={role} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={playerRoleFilter.includes(role)}
                            onChange={() => toggleRoleFilter(role)}
                            className="w-3.5 h-3.5 rounded"
                          />
                          <span>{role}</span>
                        </label>
                      ))}
                      {visibleRoleOptions.length === 0 && (
                        <p className="text-xs text-gray-500">No matching roles</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_120px_100px_64px_88px] gap-2 px-4 py-2 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                  <span>Name</span><span>Role</span><span>Base</span><span></span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-gray-800">
                  {filteredPlayers.map(p => (
                    <div key={p.id} className="grid grid-cols-[1fr_120px_100px_64px_88px] gap-2 px-4 py-3 items-center text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                        <span className="font-medium truncate">{p.name}</span>
                      </div>
                      <span className="text-gray-400">{p.role}</span>
                      <span className="text-yellow-400">{p.basePrice} pts</span>
                      <span className="text-[11px] text-gray-500">{p.photoUrl ? 'Photo' : 'No photo'}</span>
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => startEditPlayer(p)} className="text-blue-400 hover:text-blue-300 text-xs">Edit</button>
                        <button onClick={() => removePlayer(p.id)} className="text-gray-600 hover:text-red-400 text-lg leading-none">×</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
                  Showing {filteredPlayers.length} of {players.length} player{players.length !== 1 ? 's' : ''}
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <button onClick={() => setStep('teams')} className="btn-secondary">← Back</button>
              <button
                onClick={() => setStep(config.engine === 'draft' ? 'categories' : 'preallocate')}
                disabled={!players.length}
                className="btn-primary disabled:opacity-40"
              >
                {config.engine === 'draft' ? 'Next: Categories →' : 'Next: Retain →'}
              </button>
            </div>
          </div>
        )}

        {/* --- Step: Category order (Round Robin Draft only) --- */}
        {step === 'categories' && config.engine === 'draft' && (
          <div className="space-y-4">
            <p className="text-gray-400 text-sm">
              Choose the order categories will be drafted in. Every team picks from category 1 until it's exhausted, then category 2, and so on.
            </p>
            {categoryOrder.length === 0 ? (
              <p className="text-gray-500 italic text-sm">Add players first to set a category order.</p>
            ) : (
              <div className="space-y-2">
                {categoryOrder.map((cat, i) => (
                  <div key={cat} className="auction-surface rounded-xl px-4 py-3 flex items-center gap-3">
                    <span className="text-gray-500 font-mono w-6 text-center">{i + 1}</span>
                    <span className="flex-1 font-medium">{cat}</span>
                    <button
                      onClick={() => moveCategory(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${cat} up`}
                      className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed px-2 py-1"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveCategory(i, 1)}
                      disabled={i === categoryOrder.length - 1}
                      aria-label={`Move ${cat} down`}
                      className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed px-2 py-1"
                    >
                      ▼
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between">
              <button onClick={() => setStep('players')} className="btn-secondary">← Back</button>
              <button onClick={() => setStep('preallocate')} className="btn-primary">Next: Retain →</button>
            </div>
          </div>
        )}

        {/* --- Step: Pre-allocate --- */}
        {step === 'preallocate' && (
          <div className="space-y-4">
            <p className="text-gray-400 text-sm">Optionally assign retained/pre-allocated players to teams before the auction. These players won't go to auction.</p>
            {players.length === 0 && <p className="text-gray-500 italic text-sm">No players added yet.</p>}
            {players.length > 0 && (
              <input
                type="text"
                placeholder="Search players…"
                value={retainSearch}
                onChange={e => setRetainSearch(e.target.value)}
                className="input-field"
              />
            )}
            <div className="space-y-2 max-h-96 overflow-y-auto border border-gray-800 rounded-xl p-2 auction-surface-soft">
              {players
                .filter(p => p.name.toLowerCase().includes(retainSearch.toLowerCase()) ||
                             p.role.toLowerCase().includes(retainSearch.toLowerCase()) ||
                             preAllocations.some(a => a.playerId === p.id)) // always show retained
                .map(p => {
                const alloc = preAllocations.find(a => a.playerId === p.id)
                return (
                  <div key={p.id} className="auction-surface-soft rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                        <span className="font-medium text-sm truncate">{p.name}</span>
                      </div>
                      <span className="ml-2 text-xs text-gray-400">{p.role}{config.engine !== 'draft' && ` • Base: ${p.basePrice}`}</span>
                    </div>
                    {alloc ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          value={alloc.teamId}
                          onChange={e => setPreAllocations(prev => prev.map(a => a.playerId === p.id ? { ...a, teamId: e.target.value } : a))}
                          className="input-field w-36 text-xs py-1"
                        >
                          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        {config.engine !== 'draft' && (
                          <input
                            type="number" min={0} placeholder="Price"
                            value={alloc.price}
                            onChange={e => setPreAllocations(prev => prev.map(a => a.playerId === p.id ? { ...a, price: e.target.value } : a))}
                            className="input-field w-24 text-xs py-1"
                          />
                        )}
                        <button
                          onClick={() => setPreAllocations(prev => prev.filter(a => a.playerId !== p.id))}
                          className="text-red-400 hover:text-red-300 text-lg leading-none px-1"
                        >×</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setPreAllocations(prev => [...prev, { playerId: p.id, teamId: teams[0]?.id, price: p.basePrice }])}
                        className="text-xs bg-blue-800 hover:bg-blue-700 px-3 py-1 rounded-lg shrink-0"
                      >
                        + Retain
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            {preAllocations.length > 0 && (
              <div className="auction-surface rounded-xl p-3 text-xs text-gray-300">
                <p className="font-semibold text-gray-300 mb-1">{preAllocations.length} player{preAllocations.length !== 1 ? 's' : ''} retained</p>
                {teams.map(t => {
                  const tAllocs = preAllocations.filter(a => a.teamId === t.id)
                  if (!tAllocs.length) return null
                  if (config.engine === 'draft') {
                    return <p key={t.id}>{t.name}: {tAllocs.length} player{tAllocs.length !== 1 ? 's' : ''} retained</p>
                  }
                  const totalCost = tAllocs.reduce((s, a) => s + Number(a.price || 0), 0)
                  return (
                    <p key={t.id}>{t.name}: {tAllocs.length} player{tAllocs.length !== 1 ? 's' : ''} — {totalCost} pts spent</p>
                  )
                })}
              </div>
            )}
            <div className="flex justify-between">
              <button onClick={() => setStep('players')} className="btn-secondary">← Back</button>
              <button onClick={() => setStep('review')} className="btn-primary">Next: Review →</button>
            </div>
          </div>
        )}

        {/* --- Step: Review --- */}
        {step === 'review' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Engine" value={config.engine === 'draft' ? 'Round Robin Draft' : 'Competitive Bidding'} />
              <StatCard label="Teams" value={config.numTeams} />
              {config.engine === 'draft' ? (
                <StatCard label="Categories" value={new Set(players.filter(p => !preAllocations.some(a => a.playerId === p.id)).map(p => p.role)).size} />
              ) : (
                <StatCard label="Points per team" value={config.pointsPerTeam} />
              )}
              {config.engine !== 'draft' && (
                <StatCard label="Bid tiers" value={tiers.length === 1 ? `+${tiers[0].increment} flat` : `${tiers.length} tiers`} />
              )}
              <StatCard label="Max players/team" value={config.maxPlayersPerTeam} />
              <StatCard label="Players" value={players.length} />
              <StatCard label="Retained" value={preAllocations.length} />
              <StatCard label="Timer" value={config.timerEnabled ? `${config.timerSeconds}s` : 'Manual'} />
              <StatCard label="Mode" value={mode === 'offline' ? 'Offline' : 'Online'} />
            </div>

            {mode === 'online' && (
              <div className="bg-blue-900/40 border border-blue-700 rounded-xl p-4 text-sm text-blue-200">
                <p className="font-semibold mb-1">Share with captains</p>
                <p>After starting, each captain visits <strong>your-server/join/ROOMCODE</strong> and enters their PIN.</p>
              </div>
            )}

            <div className="flex justify-between">
              <button onClick={() => setStep('players')} className="btn-secondary">← Back</button>
              <button onClick={handleStart} className="btn-primary text-lg px-8 py-3">
                Start Auction
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
      {children}
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="auction-surface rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  )
}
