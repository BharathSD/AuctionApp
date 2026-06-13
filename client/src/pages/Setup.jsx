import { useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Papa from 'papaparse'
import { saveAuctionConfig } from '../hooks/useAuctionStorage'

const DEFAULT_CONFIG = {
  numTeams: 4,
  pointsPerTeam: 1000,
  bidIncrement: 10,
  timerEnabled: true,
  timerSeconds: 15,
  minBidBase: 10,
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
  const [newPlayer, setNewPlayer] = useState({ name: '', role: 'Batsman', basePrice: '' })
  const [csvError, setCsvError] = useState('')
  const fileRef = useRef()

  /* ---------- helpers ---------- */
  const handleConfigChange = (field, value) => {
    const parsed = field === 'timerEnabled' ? value : Number(value) || value
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
    if (!newPlayer.name.trim() || !newPlayer.basePrice) return
    setPlayers(prev => [...prev, { ...newPlayer, id: `p-${Date.now()}`, basePrice: Number(newPlayer.basePrice) }])
    setNewPlayer({ name: '', role: 'Batsman', basePrice: '' })
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
          if (!name) return null
          return { id: `csv-${i}-${Date.now()}`, name: name.trim(), role: role.trim(), basePrice }
        }).filter(Boolean)
        if (!parsed.length) { setCsvError('No valid rows found. Ensure columns: name, role, basePrice'); return }
        setPlayers(prev => [...prev, ...parsed])
      },
      error: () => setCsvError('Failed to parse CSV.'),
    })
    fileRef.current.value = ''
  }

  const handleStart = () => {
    if (!players.length) return
    const auctionData = {
      mode,
      config,
      teams: teams.map(t => ({
        ...t,
        budget: config.pointsPerTeam,
        spent: 0,
        players: [],
      })),
      players: players.map(p => ({ ...p, status: 'unsold', soldTo: null, soldPrice: null })),
      roomCode: mode === 'online' ? Math.random().toString(36).slice(2, 8).toUpperCase() : null,
      createdAt: Date.now(),
    }
    saveAuctionConfig(auctionData)
    if (mode === 'offline') navigate('/auction/offline')
    else navigate('/auction/online/admin')
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
          {[['config','⚙️ Config'], ['teams','👕 Teams'], ['players','🏃 Players'], ['review','✅ Review']].map(([s, label]) => (
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
            <Field label="Bid Increment">
              <input type="number" min={1} value={config.bidIncrement}
                onChange={e => handleConfigChange('bidIncrement', e.target.value)}
                className="input-field" />
            </Field>
            <Field label="Minimum Base Bid">
              <input type="number" min={1} value={config.minBidBase}
                onChange={e => handleConfigChange('minBidBase', e.target.value)}
                className="input-field" />
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
              <p className="text-xs text-gray-500 mb-3">Columns: <code>name, role, basePrice</code></p>
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
            </div>

            {/* Player list */}
            {players.length > 0 && (
              <div className="bg-gray-900 rounded-xl overflow-hidden">
                <div className="grid grid-cols-[1fr_120px_100px_40px] gap-2 px-4 py-2 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                  <span>Name</span><span>Role</span><span>Base</span><span></span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-gray-800">
                  {players.map(p => (
                    <div key={p.id} className="grid grid-cols-[1fr_120px_100px_40px] gap-2 px-4 py-3 items-center text-sm">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-gray-400">{p.role}</span>
                      <span className="text-yellow-400">{p.basePrice} pts</span>
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
              <button onClick={() => setStep('review')} disabled={!players.length} className="btn-primary disabled:opacity-40">Next: Review →</button>
            </div>
          </div>
        )}

        {/* --- Step: Review --- */}
        {step === 'review' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Teams" value={config.numTeams} />
              <StatCard label="Points per team" value={config.pointsPerTeam} />
              <StatCard label="Bid increment" value={config.bidIncrement} />
              <StatCard label="Players" value={players.length} />
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
