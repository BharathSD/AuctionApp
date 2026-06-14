import { Routes, Route, Navigate } from 'react-router-dom'
import Landing from './pages/Landing'
import Setup from './pages/Setup'
import OfflineAuction from './pages/OfflineAuction'
import AdminOnline from './pages/AdminOnline'
import CaptainJoin from './pages/CaptainJoin'
import CaptainBidding from './pages/CaptainBidding'
import Results from './pages/Results'
import ViewerDisplay from './pages/ViewerDisplay'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/setup/:mode" element={<Setup />} />
      <Route path="/auction/offline" element={<OfflineAuction />} />
      <Route path="/auction/online/admin" element={<AdminOnline />} />
      <Route path="/join/:roomCode" element={<CaptainJoin />} />
      <Route path="/auction/online/captain" element={<CaptainBidding />} />
      <Route path="/watch/:roomCode" element={<ViewerDisplay />} />
      <Route path="/results" element={<Results />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
