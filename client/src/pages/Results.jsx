import { useNavigate } from 'react-router-dom'
import { loadBestAvailableAuctionData, clearAuctionState } from '../hooks/useAuctionStorage'
import PlayerAvatar from '../components/PlayerAvatar'

export default function Results() {
  const navigate = useNavigate()
  const resultData = loadBestAvailableAuctionData()

  if (!resultData) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">No auction data found.</p>
          <button onClick={() => navigate('/')} className="btn-primary">Go Home</button>
        </div>
        <style>{`.btn-primary{background:#2563eb;color:white;padding:.5rem 1.25rem;border-radius:.75rem;font-weight:600;cursor:pointer}`}</style>
      </div>
    )
  }

  const { teams = [], players = [], config = {}, mode } = resultData
  const soldPlayers = players.filter(p => p.status === 'sold')
  const unsoldPlayers = players.filter(p => p.status !== 'sold')

  const exportXLSX = async () => {
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
    ]

    // Column header row
    const headerRow = rosterSheet.addRow(['Team', 'Player', 'Role', 'Base Price', 'Sold Price'])
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
      const teamHeaderRow = rosterSheet.addRow([team.name, '', '', '', ''])
      rosterSheet.mergeCells(teamHeaderRow.number, 1, teamHeaderRow.number, 5)
      teamHeaderRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
      teamHeaderRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } }
      teamHeaderRow.getCell(1).alignment = { horizontal: 'left', indent: 1 }
      teamHeaderRow.height = 20

      if (roster.length === 0) {
        const emptyRow = rosterSheet.addRow(['', 'No players acquired', '', '', ''])
        emptyRow.getCell(2).font = { italic: true, color: { argb: 'FF9CA3AF' } }
        emptyRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } }
        })
      } else {
        roster.forEach(p => {
          const row = rosterSheet.addRow(['', p.name, p.role, p.basePrice, p.soldPrice])
          row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } }
            cell.alignment = { horizontal: 'left' }
          })
          row.getCell(4).alignment = { horizontal: 'right' }
          row.getCell(5).alignment = { horizontal: 'right' }
          row.getCell(5).font = { bold: true }
        })
        // Team subtotal row
        const subtotal = roster.reduce((s, p) => s + p.soldPrice, 0)
        const subtotalRow = rosterSheet.addRow(['', '', `${roster.length} players`, 'Spent:', subtotal])
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
      const budgetRow = rosterSheet.addRow(['', '', '', 'Budget left:', team.budget])
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
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">🏆</div>
          <h1 className="text-3xl font-extrabold mb-1">Auction Results</h1>
          <p className="text-gray-400 text-sm">
            {soldPlayers.length} of {players.length} players sold · {mode === 'offline' ? 'Offline' : 'Online'} auction
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <StatCard label="Total Players" value={players.length} />
          <StatCard label="Sold" value={soldPlayers.length} color="text-green-400" />
          <StatCard label="Unsold" value={unsoldPlayers.length} color="text-red-400" />
          <StatCard label="Points spent" value={soldPlayers.reduce((s, p) => s + p.soldPrice, 0)} color="text-yellow-400" />
        </div>

        {/* Team rosters */}
        <div className="mb-10">
          <h2 className="text-xl font-bold mb-4">Team Rosters</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {teams.map(team => {
              const roster = players.filter(p => p.status === 'sold' && p.soldTo === team.id)
              const pct = Math.round((team.budget / config.pointsPerTeam) * 100)
              return (
                <div key={team.id} className="bg-gray-900 rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 bg-gray-800 flex justify-between items-center">
                    <h3 className="font-bold">{team.name}</h3>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Budget left</p>
                      <p className="text-yellow-400 font-bold">{team.budget} pts</p>
                    </div>
                  </div>
                  <div className="px-4 py-1">
                    <div className="w-full bg-gray-700 rounded-full h-1.5 my-2">
                      <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  {roster.length === 0 ? (
                    <p className="px-4 py-3 text-gray-600 text-sm">No players acquired</p>
                  ) : (
                    <div className="divide-y divide-gray-800">
                      {roster.map((p, i) => (
                        <div key={i} className="px-4 py-2.5 flex justify-between items-center">
                          <div className="flex items-center gap-2 min-w-0">
                            <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                            <div className="min-w-0">
                            <p className="text-sm font-medium">{p.name}</p>
                            <p className="text-xs text-gray-500">{p.role}</p>
                            </div>
                          </div>
                          <p className="text-yellow-400 font-bold text-sm">{p.soldPrice} pts</p>
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
            <h2 className="text-xl font-bold mb-4">Unsold Players</h2>
            <div className="bg-gray-900 rounded-2xl divide-y divide-gray-800">
              {unsoldPlayers.map((p, i) => (
                <div key={i} className="px-4 py-3 flex justify-between items-center">
                  <div className="flex items-center gap-2 min-w-0">
                    <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                    <div className="min-w-0">
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-gray-500">{p.role}</p>
                    </div>
                  </div>
                  <p className="text-gray-500 text-sm">Base: {p.basePrice} pts</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-4 justify-center">
          <button onClick={exportXLSX} className="btn-secondary flex items-center gap-2">
            📥 Export XLSX
          </button>
          <button onClick={handleNewAuction} className="btn-primary">
            🏏 New Auction
          </button>
        </div>
      </div>

      <style>{`
        .btn-primary { background: #2563eb; color: white; padding: 0.5rem 1.5rem; border-radius: 0.75rem; font-weight: 600; cursor: pointer; }
        .btn-primary:hover { background: #1d4ed8; }
        .btn-secondary { background: #374151; color: white; padding: 0.5rem 1.5rem; border-radius: 0.75rem; font-weight: 600; cursor: pointer; }
        .btn-secondary:hover { background: #4b5563; }
      `}</style>
    </div>
  )
}

function StatCard({ label, value, color = 'text-white' }) {
  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
