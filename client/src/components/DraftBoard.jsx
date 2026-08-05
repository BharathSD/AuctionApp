import PlayerAvatar from './PlayerAvatar'
import Icon from './Icon'
import TimerRing from './TimerRing'

// Shared presentational body for the Round Robin Selection console — used by
// both the Offline single-screen page and the Online admin page (the two
// pages differ only in their top bar / connection chrome, which they keep
// themselves; this component owns everything below it).

const ROLE_COLORS = {
  Batsman: 'bg-blue-700',
  Bowler: 'bg-green-700',
  'All-rounder': 'bg-purple-700',
  'All Rounder': 'bg-purple-700',
  'Wicket-keeper': 'bg-orange-700',
  'Super Striker': 'bg-rose-600',
  PLAYER: 'bg-slate-600',
}

export default function DraftBoard({ state, currentTurnTeam, onStart, onPick, onUndoPick, canUndoPick, onRandomizeOrder, canStart, children }) {
  const { status, teams, players, categories, categoryGroups, currentCategoryIdx, pickOrder, currentTurnIdx, picks, events = [], paused, timerLeft, config } = state
  // Reshuffling mid-draft is only allowed at a round boundary — currentTurnIdx
  // resets to 0 exactly when the pick order completes a full wrap, meaning
  // nobody in this pass through the team list has picked or been skipped yet.
  const canReshuffleNow = status === 'running' && currentTurnIdx === 0
  // Derived locally rather than trusting a precomputed `state.currentCategory`
  // — the offline reducer's state doesn't carry one (only the online engine's
  // publicDraftState payload does), so this keeps both callers correct.
  const currentCategory = categories[currentCategoryIdx] ?? null
  const currentCategoryRoles = categoryGroups?.[currentCategoryIdx]?.roles || []
  const nextTurnTeamId = pickOrder.length > 0 ? pickOrder[(currentTurnIdx + 1) % pickOrder.length] : null
  const nextTurnTeam = teams.find(t => t.id === nextTurnTeamId) || null
  const pickedCount = players.filter(p => p.status === 'sold').length
  const totalPlayers = players.length

  if (status === 'finished') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
        <h2 className="text-3xl font-bold">Selection Complete!</h2>
        <p className="text-gray-400">{pickedCount} of {totalPlayers} players picked</p>
        <div className="w-full max-w-2xl space-y-3 max-h-[60vh] overflow-y-auto">
          {teams.map(team => (
            <div key={team.id} className="auction-surface rounded-xl p-4 text-left">
              <p className="font-semibold mb-2">{team.name} <span className="text-xs text-gray-500 font-normal">({team.players.length} players)</span></p>
              {team.players.length === 0 ? (
                <p className="text-sm text-gray-500">No players</p>
              ) : (
                <div className="space-y-2">
                  {[...team.players].reverse().map(player => (
                    <div key={player.id} className="flex items-center gap-3 text-sm">
                      <PlayerAvatar name={player.name} photoUrl={player.photoUrl} size="xs" />
                      <span className="text-gray-300 truncate">{player.name}</span>
                      <span className="text-xs text-gray-500">{player.role}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Left panel: current turn + category ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 overflow-y-auto">
        {status === 'idle' && (
          <div className="text-center max-w-sm">
            {children}
            {pickOrder.length === 0 ? (
              <>
                <p className="text-gray-400 mb-2 text-lg">Pick order hasn't been set yet</p>
                <p className="text-gray-500 text-sm mb-6">Randomize which team picks 1st, 2nd, 3rd… before starting.</p>
                <button onClick={onRandomizeOrder} className="btn-secondary text-lg px-8 py-3 inline-flex items-center gap-2">
                  <Icon name="shuffle" size={18} /> Set Random Pick Order
                </button>
              </>
            ) : (
              <>
                <p className="text-gray-400 mb-3 text-sm uppercase tracking-widest">Pick Order</p>
                <ol className="space-y-1.5 mb-6 text-left inline-block mx-auto">
                  {pickOrder.map((teamId, i) => {
                    const team = teams.find(t => t.id === teamId)
                    return (
                      <li key={teamId} className="text-white">
                        <span className="text-gray-500 mr-2 font-mono">{i + 1}.</span>{team?.name}
                      </li>
                    )
                  })}
                </ol>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <button onClick={onRandomizeOrder} className="text-gray-400 hover:text-white text-sm border border-gray-700 px-3 py-2 rounded-lg inline-flex items-center gap-1.5">
                    <Icon name="shuffle" size={14} /> Re-shuffle
                  </button>
                  <button
                    onClick={onStart}
                    disabled={!canStart}
                    className="btn-primary text-xl px-10 py-4 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Start Selection
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {status === 'running' && (
          <div className="w-full flex-1 max-w-5xl mx-auto flex flex-col gap-6 py-2">
            {/* Category progress strip */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {categories.map((cat, i) => (
                <span
                  key={cat}
                  className={`text-xs px-3 py-1 rounded-full font-semibold ${
                    i === currentCategoryIdx ? 'bg-blue-600 text-white' : i < currentCategoryIdx ? 'bg-gray-800 text-gray-500 line-through' : 'bg-gray-800 text-gray-400'
                  }`}
                >
                  {i + 1}. {cat}
                </span>
              ))}
            </div>

            <div className="auction-surface rounded-3xl p-8 text-center shadow-2xl border border-gray-700 flex flex-col items-center gap-4">
              <div className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold ${ROLE_COLORS[currentCategory] || 'bg-gray-700'}`}>
                {currentCategory}
              </div>
              <p className="text-sm text-gray-400 uppercase tracking-[0.25em]">On the clock</p>
              <h2 className="text-4xl font-extrabold">{currentTurnTeam?.name || '—'}</h2>
              {nextTurnTeam && nextTurnTeam.id !== currentTurnTeam?.id && (
                <p className="text-sm text-gray-500">Next: <span className="text-gray-300 font-semibold">{nextTurnTeam.name}</span></p>
              )}
              {config.timerEnabled && (
                <TimerRing seconds={timerLeft} total={config.timerSeconds} paused={paused} size={110} />
              )}
            </div>

            {/* Available players in current category */}
            <div>
              <p className="text-sm text-gray-400 text-center uppercase tracking-[0.25em] mb-3">
                Click a player to assign to {currentTurnTeam?.name}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {players.filter(p => p.status === 'pending' && currentCategoryRoles.includes(p.role)).map(p => (
                  <button
                    key={p.id}
                    onClick={() => onPick(p.id)}
                    disabled={paused}
                    className="team-bid-btn rounded-2xl py-3 px-3 font-bold transition-all flex flex-col items-center gap-2 justify-center disabled:opacity-40 disabled:cursor-not-allowed text-center"
                  >
                    <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                    <div className="w-full min-w-0">
                      <div className="truncate">{p.name}</div>
                      {p.bowling && <div className="text-lg">⚾</div>}
                      {p.comments && (
                        <p className="text-xs text-gray-400 italic mt-1 line-clamp-2">{p.comments}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {players.filter(p => p.status === 'pending' && currentCategoryRoles.includes(p.role)).length === 0 && (
                <p className="text-center text-sm text-gray-600 mt-4">No players left in this category.</p>
              )}
            </div>

            <div className="flex justify-center">
              <button
                onClick={onUndoPick}
                disabled={!canUndoPick}
                className="bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-2xl py-3 px-8 font-bold text-sm inline-flex items-center justify-center gap-2"
              >
                <Icon name="undo" size={16} /> Undo Last Pick
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right panel: Teams & Pick log ── */}
      <div className="w-72 lg:w-80 2xl:w-96 auction-surface border-l border-gray-800 flex flex-col" style={{ height: 'calc(100vh - 57px)' }}>
        <div className="p-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-400 uppercase tracking-widest">Pick Order</p>
            {canReshuffleNow && (
              <button
                onClick={onRandomizeOrder}
                title="Re-shuffle pick order"
                className="text-gray-400 hover:text-white text-xs border border-gray-700 px-2 py-1 rounded-lg inline-flex items-center gap-1"
              >
                <Icon name="shuffle" size={12} /> Re-shuffle
              </button>
            )}
          </div>
          <div className="space-y-2">
            {(pickOrder.length > 0 ? pickOrder : teams.map(t => t.id)).map((teamId, i) => {
              const team = teams.find(t => t.id === teamId)
              if (!team) return null
              const isTurn = currentTurnTeam?.id === team.id
              const isNext = !isTurn && nextTurnTeam?.id === team.id
              return (
                <div key={team.id} className={`rounded-lg px-3 py-2.5 ${isTurn ? 'bg-blue-900/60 ring-1 ring-blue-500' : 'bg-gray-800'}`}>
                  <div className="flex justify-between items-center">
                    <span className="text-base font-semibold truncate">
                      <span className="text-gray-500 font-mono mr-1.5">{i + 1}.</span>{team.name}
                    </span>
                    <span className="text-sm text-gray-400">{team.players.length} picked</span>
                  </div>
                  {(isTurn || isNext) && (
                    <p className={`text-xs mt-1 font-semibold ${isTurn ? 'text-blue-300' : 'text-gray-500'}`}>
                      {isTurn ? 'On the clock' : 'Next'}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex-1 p-4 overflow-y-auto min-h-0">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-400 uppercase tracking-widest">Pick Log</p>
            {picks.length > 0 && <span className="text-xs text-gray-500">{picks.length} pick{picks.length !== 1 ? 's' : ''}</span>}
          </div>
          {picks.length === 0 && events.length === 0 && <p className="text-sm text-gray-600">No picks yet.</p>}
          <div className="space-y-1.5">
            {[
              ...picks.map(entry => ({ kind: 'pick', ts: entry.ts, entry })),
              ...events.map(entry => ({ kind: entry.type, ts: entry.ts, entry })),
            ]
              .sort((a, b) => b.ts - a.ts)
              .slice(0, 30)
              .map(({ kind, ts, entry }, i) => {
                const isLatest = i === 0
                if (kind === 'shuffle') {
                  return (
                    <div key={`shuffle-${ts}`} className={`rounded-lg px-2.5 py-2 text-sm flex items-center gap-1.5 ${isLatest ? 'bg-blue-900/40 ring-1 ring-blue-700/60' : 'bg-gray-800/40'}`}>
                      <Icon name="shuffle" size={12} className="text-gray-500 shrink-0" />
                      <span className="text-gray-400 italic">Pick order re-shuffled</span>
                    </div>
                  )
                }
                const team = teams.find(t => t.id === entry.teamId)
                const player = players.find(p => p.id === entry.playerId)
                return (
                  <div key={`${entry.playerId}-${ts}`} className={`rounded-lg px-2.5 py-2 text-sm ${isLatest ? 'bg-blue-900/40 ring-1 ring-blue-700/60' : 'bg-gray-800/40'}`}>
                    <span className={`truncate ${isLatest ? 'text-blue-100 font-semibold' : 'text-gray-300'}`}>{team?.name}</span>
                    <span className="text-gray-500"> picked </span>
                    <span className="text-gray-200">{player?.name}</span>
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    </div>
  )
}
