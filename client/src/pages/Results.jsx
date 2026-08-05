import { useNavigate } from 'react-router-dom'
import { loadBestAvailableAuctionData, clearAuctionState } from '../hooks/useAuctionStorage'
import PlayerAvatar from '../components/PlayerAvatar'
import Icon from '../components/Icon'
import BrandMark from '../components/BrandMark'

export default function Results() {
  const navigate = useNavigate()
  const resultData = loadBestAvailableAuctionData()

  if (!resultData) {
    return (
      <div className="app-shell text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">No auction data found.</p>
          <button onClick={() => navigate('/')} className="btn-primary">Go Home</button>
        </div>
      </div>
    )
  }

  const { teams = [], players = [], config = {}, mode } = resultData
  const isDraft = config.engine === 'draft'
  const soldPlayers = players.filter(p => p.status === 'sold')
  const unsoldPlayers = players.filter(p => p.status !== 'sold')
  const teamNameById = new Map(teams.map(t => [t.id, t.name]))

  const snapshotBids = Array.isArray(resultData.bids)
    ? resultData.bids
    : Array.isArray(resultData?._runtime?.bids)
      ? resultData._runtime.bids
      : []

  const exportDraftXLSX = async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Cricket Auction App'
    wb.created = new Date()

    const TEAM_COLORS = [
      'FFdbeafe', 'FFdcfce7', 'FFfef9c3', 'FFfce7f3',
      'FFede9fe', 'FFffedd5', 'FFf0fdfa', 'FFfff7ed',
    ]
    const TEAM_HEADER_COLORS = [
      'FF1d4ed8', 'FF15803d', 'FFca8a04', 'FFbe185d',
      'FF7c3aed', 'FFc2410c', 'FF0f766e', 'FFea580c',
    ]

    // ── Sheet 1: Rosters (grouped by team, no price/budget) ──
    const rosterSheet = wb.addWorksheet('Rosters')
    rosterSheet.columns = [
      { key: 'team', width: 22 },
      { key: 'player', width: 24 },
      { key: 'role', width: 18 },
    ]
    const headerRow = rosterSheet.addRow(['Team', 'Player', 'Category'])
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
      cell.alignment = { horizontal: 'center' }
    })

    teams.forEach((team, ti) => {
      const roster = players.filter(p => p.status === 'sold' && p.soldTo === team.id)
      const rowColor = TEAM_COLORS[ti % TEAM_COLORS.length]
      const headerColor = TEAM_HEADER_COLORS[ti % TEAM_HEADER_COLORS.length]

      const teamHeaderRow = rosterSheet.addRow([team.name, '', ''])
      rosterSheet.mergeCells(teamHeaderRow.number, 1, teamHeaderRow.number, 3)
      teamHeaderRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
      teamHeaderRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } }
      teamHeaderRow.getCell(1).alignment = { horizontal: 'left', indent: 1 }
      teamHeaderRow.height = 20

      if (roster.length === 0) {
        const emptyRow = rosterSheet.addRow(['', 'No players picked', ''])
        emptyRow.getCell(2).font = { italic: true, color: { argb: 'FF9CA3AF' } }
        emptyRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } }
        })
      } else {
        roster.forEach(p => {
          const row = rosterSheet.addRow(['', p.name, p.role])
          row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } }
            cell.alignment = { horizontal: 'left' }
          })
        })
        const subtotalRow = rosterSheet.addRow(['', '', `${roster.length} players`])
        subtotalRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } }
          cell.font = { italic: true }
        })
      }
      rosterSheet.addRow([])
    })

    // ── Sheet 2: Summary (one row per team) ──────────────────
    const summarySheet = wb.addWorksheet('Summary')
    summarySheet.columns = [
      { key: 'team', width: 22 },
      { key: 'players', width: 14 },
    ]
    const sumHeader = summarySheet.addRow(['Team', 'Players Picked'])
    sumHeader.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
      cell.alignment = { horizontal: 'center' }
    })
    teams.forEach((team, ti) => {
      const roster = players.filter(p => p.status === 'sold' && p.soldTo === team.id)
      const row = summarySheet.addRow([team.name, roster.length])
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAM_COLORS[ti % TEAM_COLORS.length] } }
        cell.alignment = { horizontal: 'center' }
      })
      row.getCell(1).alignment = { horizontal: 'left' }
    })
    const totalRow = summarySheet.addRow(['TOTAL', soldPlayers.length])
    totalRow.eachCell(cell => {
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe2e8f0' } }
      cell.alignment = { horizontal: 'center' }
    })
    totalRow.getCell(1).alignment = { horizontal: 'left' }

    // ── Sheet 3: Pick order (derived from final rosters — reliable across
    // both offline and online since it doesn't depend on the live picks log) ──
    const pickSheet = wb.addWorksheet('Pick Order')
    pickSheet.columns = [
      { key: 'pick', width: 8 },
      { key: 'time', width: 24 },
      { key: 'player', width: 24 },
      { key: 'category', width: 18 },
      { key: 'team', width: 22 },
    ]
    const pickHeader = pickSheet.addRow(['#', 'Time', 'Player', 'Category', 'Team'])
    pickHeader.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
      cell.alignment = { horizontal: 'center' }
    })
    const formatTime = (ts) => {
      if (!ts) return ''
      const d = new Date(ts)
      return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
    }
    const orderedPicks = [...soldPlayers].sort((a, b) => (Number(a.soldAt) || 0) - (Number(b.soldAt) || 0))
    orderedPicks.forEach((p, i) => {
      pickSheet.addRow([i + 1, formatTime(p.soldAt), p.name, p.role, teamNameById.get(p.soldTo) || p.soldTo || ''])
    })
    if (orderedPicks.length === 0) {
      pickSheet.addRow(['', '', 'No picks recorded.', '', ''])
    }

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'selection-results.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportXLSX = async () => {
    if (isDraft) return exportDraftXLSX()
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Cricket Auction App'
    wb.created = new Date()

    // ── Sheet 1: Rosters (grouped by team) ──────────────────
    const rosterSheet = wb.addWorksheet('Rosters')
    rosterSheet.columns = [
      { key: 'team',      width: 22 },
      { key: 'player',    width: 24 },
      { key: 'role',      width: 18 },
      { key: 'basePrice', width: 14 },
      { key: 'soldPrice', width: 14 },
      { key: 'bowling',   width: 10 },
      { key: 'comments',  width: 30 },
    ]

    // Column header row
    const headerRow = rosterSheet.addRow(['Team', 'Player', 'Role', 'Base Price', 'Sold Price', 'Bowls', 'Comments'])
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
      cell.alignment = { horizontal: 'center' }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF93C5FD' } } }
    })

    // Team colour palette (cycles if > 8 teams)
    const TEAM_COLORS = [
      'FFdbeafe', 'FFdcfce7', 'FFfef9c3', 'FFfce7f3',
      'FFede9fe', 'FFffedd5', 'FFf0fdfa', 'FFfff7ed',
    ]
    const TEAM_HEADER_COLORS = [
      'FF1d4ed8', 'FF15803d', 'FFca8a04', 'FFbe185d',
      'FF7c3aed', 'FFc2410c', 'FF0f766e', 'FFea580c',
    ]

    teams.forEach((team, ti) => {
      const roster = players.filter(p => p.status === 'sold' && p.soldTo === team.id)
      const rowColor   = TEAM_COLORS[ti % TEAM_COLORS.length]
      const headerColor = TEAM_HEADER_COLORS[ti % TEAM_HEADER_COLORS.length]

      // Team header row (spans all cols, merged)
      const teamHeaderRow = rosterSheet.addRow([team.name, '', '', '', '', '', ''])
      rosterSheet.mergeCells(teamHeaderRow.number, 1, teamHeaderRow.number, 7)
      teamHeaderRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
      teamHeaderRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } }
      teamHeaderRow.getCell(1).alignment = { horizontal: 'left', indent: 1 }
      teamHeaderRow.height = 20

      if (roster.length === 0) {
        const emptyRow = rosterSheet.addRow(['', 'No players acquired', '', '', '', '', ''])
        emptyRow.getCell(2).font = { italic: true, color: { argb: 'FF9CA3AF' } }
        emptyRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } }
        })
      } else {
        roster.forEach(p => {
          const row = rosterSheet.addRow(['', p.name, p.role, p.basePrice, p.soldPrice, p.bowling ? 'Yes' : 'No', p.comments || ''])
          row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } }
            cell.alignment = { horizontal: 'left' }
          })
          row.getCell(4).alignment = { horizontal: 'right' }
          row.getCell(5).alignment = { horizontal: 'right' }
          row.getCell(5).font = { bold: true }
          row.getCell(6).alignment = { horizontal: 'center' }
        })
        // Team subtotal row
        const subtotal = roster.reduce((s, p) => s + p.soldPrice, 0)
        const subtotalRow = rosterSheet.addRow(['', '', `${roster.length} players`, 'Spent:', subtotal, '', ''])
        subtotalRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } }
          cell.font = { italic: true }
        })
        subtotalRow.getCell(4).font = { bold: true, italic: true }
        subtotalRow.getCell(5).font = { bold: true, italic: true }
        subtotalRow.getCell(5).alignment = { horizontal: 'right' }
        subtotalRow.getCell(4).alignment = { horizontal: 'right' }
      }

      // Budget remaining row
      const budgetRow = rosterSheet.addRow(['', '', '', 'Budget left:', team.budget, '', ''])
      budgetRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } }
      })
      budgetRow.getCell(4).font = { bold: true, italic: true }
      budgetRow.getCell(4).alignment = { horizontal: 'right' }
      budgetRow.getCell(5).font = { bold: true }
      budgetRow.getCell(5).alignment = { horizontal: 'right' }

      // Spacer
      rosterSheet.addRow([])
    })

    // ── Sheet 2: Summary (one row per team) ─────────────────
    const summarySheet = wb.addWorksheet('Summary')
    summarySheet.columns = [
      { key: 'team',       width: 22 },
      { key: 'players',    width: 14 },
      { key: 'spent',      width: 16 },
      { key: 'budget',     width: 16 },
      { key: 'pct',        width: 16 },
    ]

    const sumHeader = summarySheet.addRow(['Team', 'Players', 'Points Spent', 'Budget Left', '% Used'])
    sumHeader.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
      cell.alignment = { horizontal: 'center' }
    })

    teams.forEach((team, ti) => {
      const roster = players.filter(p => p.status === 'sold' && p.soldTo === team.id)
      const spent = roster.reduce((s, p) => s + p.soldPrice, 0)
      const pct = Math.round((spent / config.pointsPerTeam) * 100)
      const row = summarySheet.addRow([team.name, roster.length, spent, team.budget, `${pct}%`])
      const rowColor = TEAM_COLORS[ti % TEAM_COLORS.length]
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } }
        cell.alignment = { horizontal: 'center' }
      })
      row.getCell(1).alignment = { horizontal: 'left' }
    })

    // Totals row
    const totalSpent = soldPlayers.reduce((s, p) => s + p.soldPrice, 0)
    const totalRow = summarySheet.addRow(['TOTAL', soldPlayers.length, totalSpent, '', ''])
    totalRow.eachCell(cell => {
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe2e8f0' } }
      cell.alignment = { horizontal: 'center' }
    })
    totalRow.getCell(1).alignment = { horizontal: 'left' }

    // ── Sheet 3: Bid log / audit trail ───────────────────────
    const bidSheet = wb.addWorksheet('Bid Log')
    bidSheet.columns = [
      { key: 'time', width: 24 },
      { key: 'event', width: 14 },
      { key: 'player', width: 28 },
      { key: 'team', width: 22 },
      { key: 'price', width: 14 },
      { key: 'source', width: 18 },
    ]

    const bidHeader = bidSheet.addRow(['Time', 'Event', 'Player', 'Team', 'Price', 'Source'])
    bidHeader.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
      cell.alignment = { horizontal: 'center' }
    })

    const formatTime = (ts) => {
      if (!ts) return ''
      const d = new Date(ts)
      return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
    }

    // Snapshot bid list is usually newest-first for the currently active player.
    ;[...snapshotBids].reverse().forEach(b => {
      bidSheet.addRow([
        formatTime(b.ts),
        'BID',
        b.playerName || '',
        teamNameById.get(b.teamId) || b.teamId || '',
        b.price ?? '',
        'live snapshot',
      ])
    })

    // Sold entries are always available in final results and act as durable audit rows.
    soldPlayers.forEach(p => {
      bidSheet.addRow([
        formatTime(p.soldAt),
        'SOLD',
        p.name,
        teamNameById.get(p.soldTo) || p.soldTo || '',
        p.soldPrice ?? '',
        'final roster',
      ])
    })

    if (bidSheet.rowCount === 1) {
      bidSheet.addRow(['', 'INFO', 'No bid/audit events available in current snapshot.', '', '', ''])
    }

    bidSheet.eachRow((row, idx) => {
      if (idx === 1) return
      row.getCell(2).alignment = { horizontal: 'center' }
      row.getCell(5).alignment = { horizontal: 'right' }
      const event = String(row.getCell(2).value || '')
      if (event === 'SOLD') {
        row.getCell(2).font = { bold: true, color: { argb: 'FF22C55E' } }
      } else if (event === 'BID') {
        row.getCell(2).font = { bold: true, color: { argb: 'FF60A5FA' } }
      }
    })

    // ── Write and download ───────────────────────────────────
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'auction-results.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleNewAuction = () => {
    clearAuctionState()
    navigate('/')
  }

  return (
    <div className="app-shell text-white">
      <div className="app-page max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="mb-10 text-left">
          <div className="flex items-center justify-between mb-6">
            <BrandMark size={28} withWordmark wordmark="Auction OS" />
            <span className="pill-static"><Icon name="trophy" size={13} /> Final results</span>
          </div>
          <p className="hero-kicker mb-2">Tournament complete</p>
          <h1 className="page-title">{isDraft ? 'Selection Results' : 'Auction Results'}</h1>
          <p className="text-gray-400 text-sm mt-3">
            {soldPlayers.length} of {players.length} players {isDraft ? 'picked' : 'sold'} · {mode === 'offline' ? 'Offline' : 'Online'} {isDraft ? 'selection' : 'auction'}
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <StatCard label="Total Players" value={players.length} />
          <StatCard label={isDraft ? 'Picked' : 'Sold'} value={soldPlayers.length} color="text-green-400" />
          <StatCard label={isDraft ? 'Remaining' : 'Unsold'} value={unsoldPlayers.length} color="text-red-400" />
          {!isDraft && <StatCard label="Points spent" value={soldPlayers.reduce((s, p) => s + p.soldPrice, 0)} color="text-yellow-400" />}
          {isDraft && <StatCard label="Teams" value={teams.length} color="text-blue-400" />}
        </div>

        {/* Team rosters */}
        <div className="mb-10">
          <h2 className="text-xl font-bold mb-4">Team Rosters</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {teams.map(team => {
              const roster = players.filter(p => p.status === 'sold' && p.soldTo === team.id)
              const totalBudget = config.pointsPerTeam || 1
              const spent = roster.reduce((s, p) => s + (p.soldPrice || 0), 0)
              const usedPct = Math.min(100, Math.round((spent / totalBudget) * 100))
              return (
                <div key={team.id} className="auction-surface rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 bg-gray-800 flex justify-between items-center">
                    <h3 className="font-bold">{team.name}</h3>
                    {isDraft ? (
                      <p className="text-gray-400 text-sm">{roster.length} player{roster.length !== 1 ? 's' : ''}</p>
                    ) : (
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Budget left</p>
                        <p className="text-yellow-400 font-bold">{team.budget} pts</p>
                      </div>
                    )}
                  </div>
                  {!isDraft && (
                    <div className="px-4 pt-2 pb-1">
                      <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                        <span>{spent} pts spent</span>
                        <span>{usedPct}% of budget used</span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all ${usedPct >= 90 ? 'bg-red-400' : usedPct >= 60 ? 'bg-yellow-400' : 'bg-green-400'}`}
                          style={{ width: `${usedPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {roster.length === 0 ? (
                    <p className="px-4 py-3 text-gray-600 text-sm">No players acquired</p>
                  ) : (
                    <div className="divide-y divide-gray-800">
                      {roster.map((p, i) => (
                        <div key={i} className="px-4 py-2.5 flex justify-between items-center">
                          <div className="flex items-center gap-2 min-w-0">
                            <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                            <div className="min-w-0">
                            <p className="text-sm font-medium">{p.name} {p.bowling && '⚾'}</p>
                            <p className="text-xs text-gray-500">{p.role}</p>
                            </div>
                          </div>
                          {!isDraft && <p className="text-yellow-400 font-bold text-sm">{p.soldPrice} pts</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Unsold players */}
        {unsoldPlayers.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xl font-bold mb-4">{isDraft ? 'Unpicked Players' : 'Unsold Players'}</h2>
            <div className="auction-surface rounded-2xl divide-y divide-gray-800">
              {unsoldPlayers.map((p, i) => (
                <div key={i} className="px-4 py-3 flex justify-between items-center">
                  <div className="flex items-center gap-2 min-w-0">
                    <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                    <div className="min-w-0">
                    <p className="text-sm font-medium">{p.name} {p.bowling && '🎳'}</p>
                    <p className="text-xs text-gray-500">{p.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-4 justify-center">
          <button onClick={exportXLSX} className="btn-secondary flex items-center gap-2">
            <Icon name="download" size={16} /> Export XLSX
          </button>
          <button onClick={handleNewAuction} className="btn-primary">
            Start New Auction
          </button>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color = 'text-white' }) {
  return (
    <div className="auction-surface rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
