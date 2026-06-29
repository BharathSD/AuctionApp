import { useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Papa from 'papaparse'
import { saveAuctionConfig } from '../hooks/useAuctionStorage'
import { DEFAULT_BID_TIERS } from '../utils/bidTiers'
import { validateConfigValues, validatePlayerName, validateBasePrice, validateAuctionStartup } from '../utils/validation'
import PlayerAvatar from '../components/PlayerAvatar'

const DEFAULT_CONFIG = {
  numTeams: 4,
  pointsPerTeam: 10000,
  bidTiers: [{ upTo: null, increment: 100 }],
  timerEnabled: true,
  timerSeconds: 15,
  minBidBase: 100,
  maxPlayersPerTeam: 11,
  randomizeOrder: false,
}

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
  const [csvError, setCsvError] = useState('')
  const [preAllocations, setPreAllocations] = useState([]) // [{playerId, teamId, price}]
  const [retainSearch, setRetainSearch] = useState('')
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
    const parsed = field === 'timerEnabled' || field === 'randomizeOrder' ? value : Number(value) || value
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

  const addPlayer = () => {
    // Validate player name and price
    const nameVal = validatePlayerName(newPlayer.name)
    if (!nameVal.valid) { alert(nameVal.error); return }
    
    const priceVal = validateBasePrice(newPlayer.basePrice, config.minBidBase)
    if (!priceVal.valid) { alert(priceVal.error); return }
    
    const photoUrl = normalizePhotoUrl(newPlayer.photoUrl)
    setPlayers(prev => [...prev, { id: `p-${Date.now()}`, name: nameVal.value, role: newPlayer.role, basePrice: priceVal.value, photoUrl }])
    setNewPlayer({ name: '', role: 'Batsman', basePrice: '', photoUrl: '' })
  }

  const removePlayer = (id) => setPlayers(prev => prev.filter(p => p.id !== id))

  const handleCSV = (e) => {
    setCsvError('')
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
        setPlayers(prev => [...prev, ...parsed])
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
    const auctionData = {
      mode,
      config,
      teams: teams.map(t => {
        const myAllocs = preAllocations.filter(a => a.teamId === t.id)
        const prePlayers = myAllocs.map(a => {
          const p = players.find(pl => pl.id === a.playerId)
          return p ? { ...p, soldPrice: Number(a.price), status: 'sold', soldTo: t.id } : null
        }).filter(Boolean)
        const spent = myAllocs.reduce((s, a) => s + Number(a.price), 0)
        return { ...t, budget: config.pointsPerTeam - spent, spent, players: prePlayers }
      }),
      players: players.map(p => {
        const alloc = preAllocations.find(a => a.playerId === p.id)
        if (alloc) return { ...p, status: 'sold', soldTo: alloc.teamId, soldPrice: Number(alloc.price) }
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

  /* ---------- render ---------- */
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-3xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white text-sm">← Back</button>
          <h1 className="text-2xl font-bold">
            {mode === 'offline' ? '📺 Offline Auction Setup' : '📱 Online Auction Setup'}
          </h1>
        </div>

        {/* Step tabs */}
        <div className="flex gap-1 mb-8 bg-gray-900 rounded-xl p-1">
          {[['config','⚙️ Config'], ['teams','👕 Teams'], ['players','🏃 Players'], ['preallocate','📌 Retain'], ['review','✅ Review']].map(([s, label]) => (
            <button
              key={s}
              onClick={() => setStep(s)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${step === s ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* --- Step: Config --- */}
        {step === 'config' && (
          <div className="space-y-6">
            <Field label="Number of Teams">
              <input type="number" min={2} max={16} value={config.numTeams}
                onChange={e => handleConfigChange('numTeams', e.target.value)}
                className="input-field" />
            </Field>
            <Field label="Points per Team (budget)">
              <input type="number" min={100} value={config.pointsPerTeam}
                onChange={e => handleConfigChange('pointsPerTeam', e.target.value)}
                className="input-field" />
            </Field>
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
                        className="input-field w-20 text-center text-sm py-1"
                        placeholder="Up to"
                      />
                    )}
                    <span className="text-xs text-gray-500">→ +</span>
                    <input
                      type="number" min={1} value={tier.increment}
                      onChange={e => updateTier(idx, 'increment', e.target.value)}
                      className="input-field w-20 text-center text-sm py-1"
                      placeholder="Inc"
                    />
                    <span className="text-xs text-gray-500">pts</span>
                    {tiers.length > 1 && (
                      <button onClick={() => removeTier(idx)} className="text-red-400 hover:text-red-300 text-sm px-1">✕</button>
                    )}
                  </div>
                ))}
                <button
                  onClick={addTier}
                  className="text-blue-400 hover:text-blue-300 text-xs mt-1"
                >+ Add tier</button>
              </div>
            </Field>
            <Field label="Minimum Base Bid">
              <input type="number" min={1} value={config.minBidBase}
                onChange={e => handleConfigChange('minBidBase', e.target.value)}
                className="input-field" />
            </Field>
            <Field label="Max Players per Team">
              <input type="number" min={1} max={50} value={config.maxPlayersPerTeam}
                onChange={e => handleConfigChange('maxPlayersPerTeam', e.target.value)}
                className="input-field" />
            </Field>
            <Field label="Player Order">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={config.randomizeOrder}
                  onChange={e => handleConfigChange('randomizeOrder', e.target.checked)}
                  className="w-5 h-5 rounded" />
                <span className="text-sm text-gray-300">Randomize player auction order</span>
              </label>
            </Field>
            <Field label="Timer Mode">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={config.timerEnabled}
                  onChange={e => handleConfigChange('timerEnabled', e.target.checked)}
                  className="w-5 h-5 rounded" />
                <span className="text-sm text-gray-300">Enable countdown timer per bid</span>
              </label>
            </Field>
            {config.timerEnabled && (
              <Field label="Timer Duration (seconds)">
                <input type="number" min={5} max={120} value={config.timerSeconds}
                  onChange={e => handleConfigChange('timerSeconds', e.target.value)}
                  className="input-field" />
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
              <div key={team.id} className="bg-gray-900 rounded-xl p-4 flex gap-4 items-center">
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
            <div className="bg-gray-900 rounded-xl p-4">
              <p className="text-sm font-semibold mb-2 text-gray-300">Import from CSV</p>
              <p className="text-xs text-gray-500 mb-3">Columns: <code>name, role, basePrice</code> and optional <code>photoUrl</code></p>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV}
                className="text-sm text-gray-300 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-blue-700 file:text-white file:cursor-pointer hover:file:bg-blue-600" />
              {csvError && <p className="text-red-400 text-xs mt-2">{csvError}</p>}
            </div>

            {/* Manual Add */}
            <div className="bg-gray-900 rounded-xl p-4">
              <p className="text-sm font-semibold mb-3 text-gray-300">Add Player Manually</p>
              <div className="flex gap-3 flex-wrap">
                <input value={newPlayer.name} onChange={e => setNewPlayer(p => ({ ...p, name: e.target.value }))}
                  placeholder="Player name" className="input-field flex-1 min-w-36" />
                <select value={newPlayer.role} onChange={e => setNewPlayer(p => ({ ...p, role: e.target.value }))}
                  className="input-field w-36">
                  {['Batsman','Bowler','All-rounder','Wicket-keeper'].map(r => <option key={r}>{r}</option>)}
                </select>
                <input type="number" value={newPlayer.basePrice} onChange={e => setNewPlayer(p => ({ ...p, basePrice: e.target.value }))}
                  placeholder="Base price" className="input-field w-32" min={1} />
                <button onClick={addPlayer} className="btn-primary">Add</button>
              </div>
              <div className="mt-3">
                <input value={newPlayer.photoUrl} onChange={e => setNewPlayer(p => ({ ...p, photoUrl: e.target.value }))}
                  placeholder="Photo URL (optional)" className="input-field" />
              </div>
            </div>

            {/* Player list */}
            {players.length > 0 && (
              <div className="bg-gray-900 rounded-xl overflow-hidden">
                <div className="grid grid-cols-[1fr_120px_100px_64px_40px] gap-2 px-4 py-2 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                  <span>Name</span><span>Role</span><span>Base</span><span></span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-gray-800">
                  {players.map(p => (
                    <div key={p.id} className="grid grid-cols-[1fr_120px_100px_64px_40px] gap-2 px-4 py-3 items-center text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                        <span className="font-medium truncate">{p.name}</span>
                      </div>
                      <span className="text-gray-400">{p.role}</span>
                      <span className="text-yellow-400">{p.basePrice} pts</span>
                      <span className="text-[11px] text-gray-500">{p.photoUrl ? 'Photo' : 'No photo'}</span>
                      <button onClick={() => removePlayer(p.id)} className="text-gray-600 hover:text-red-400 text-lg leading-none">×</button>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
                  {players.length} player{players.length !== 1 ? 's' : ''} added
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <button onClick={() => setStep('teams')} className="btn-secondary">← Back</button>
              <button onClick={() => setStep('preallocate')} disabled={!players.length} className="btn-primary disabled:opacity-40">Next: Retain →</button>
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
            <div className="space-y-2 max-h-96 overflow-y-auto border border-gray-800 rounded-xl p-2">
              {players
                .filter(p => p.name.toLowerCase().includes(retainSearch.toLowerCase()) ||
                             p.role.toLowerCase().includes(retainSearch.toLowerCase()) ||
                             preAllocations.some(a => a.playerId === p.id)) // always show retained
                .map(p => {
                const alloc = preAllocations.find(a => a.playerId === p.id)
                return (
                  <div key={p.id} className="bg-gray-800 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                        <span className="font-medium text-sm truncate">{p.name}</span>
                      </div>
                      <span className="ml-2 text-xs text-gray-400">{p.role} • Base: {p.basePrice}</span>
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
                        <input
                          type="number" min={0} placeholder="Price"
                          value={alloc.price}
                          onChange={e => setPreAllocations(prev => prev.map(a => a.playerId === p.id ? { ...a, price: e.target.value } : a))}
                          className="input-field w-24 text-xs py-1"
                        />
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
              <div className="bg-gray-900 rounded-xl p-3 text-xs text-gray-400">
                <p className="font-semibold text-gray-300 mb-1">{preAllocations.length} player{preAllocations.length !== 1 ? 's' : ''} retained</p>
                {teams.map(t => {
                  const tAllocs = preAllocations.filter(a => a.teamId === t.id)
                  if (!tAllocs.length) return null
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
              <StatCard label="Teams" value={config.numTeams} />
              <StatCard label="Points per team" value={config.pointsPerTeam} />
              <StatCard label="Bid tiers" value={tiers.length === 1 ? `+${tiers[0].increment} flat` : `${tiers.length} tiers`} />
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
                🚀 Start Auction
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .input-field { background: #1f2937; border: 1px solid #374151; border-radius: 0.5rem; padding: 0.5rem 0.75rem; color: white; width: 100%; outline: none; font-size: 0.875rem; }
        .input-field:focus { border-color: #3b82f6; }
        .btn-primary { background: #2563eb; color: white; padding: 0.5rem 1.25rem; border-radius: 0.75rem; font-weight: 600; font-size: 0.875rem; cursor: pointer; transition: background 0.15s; }
        .btn-primary:hover { background: #1d4ed8; }
        .btn-secondary { background: #374151; color: white; padding: 0.5rem 1.25rem; border-radius: 0.75rem; font-weight: 600; font-size: 0.875rem; cursor: pointer; }
        .btn-secondary:hover { background: #4b5563; }
      `}</style>
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
    <div className="bg-gray-900 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  )
}
