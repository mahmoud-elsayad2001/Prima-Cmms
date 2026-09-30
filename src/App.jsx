import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import Anmeldung from './pages/Anmeldung'
import Uebersicht from './pages/Uebersicht'
import Auftraege from './pages/Auftraege'
import AuftragDetail from './pages/AuftragDetail'
import Maschinen from './pages/Maschinen'
import MaschineDetail from './pages/MaschineDetail'
import QM from './pages/QM'
import Berichte from './pages/Berichte'
import Ausfaelle from './pages/Ausfaelle'

export default function App() {
  const { session, loading } = useAuth()

  if (loading) return <Spinner text="Anmeldung wird geprüft" />
  if (!session) return <Anmeldung />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Uebersicht />} />
        <Route path="/auftraege" element={<Auftraege />} />
        <Route path="/auftraege/:id" element={<AuftragDetail />} />
        <Route path="/maschinen" element={<Maschinen />} />
        <Route path="/maschinen/:id" element={<MaschineDetail />} />
        <Route path="/ausfaelle" element={<Ausfaelle />} />
        <Route path="/qm" element={<QM />} />
        <Route path="/berichte" element={<Berichte />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
