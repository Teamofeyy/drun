import { Suspense, lazy, useLayoutEffect, type ReactNode } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { getToken } from './api'
import { PlatformLayout } from '@/components/layout/PlatformLayout'
import { Login } from './Login'
import { Card, CardContent } from '@/components/ui/card'

const AdminPage = lazy(() =>
  import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })),
)
const AgentsPage = lazy(() =>
  import('./pages/AgentsPage').then((module) => ({ default: module.AgentsPage })),
)
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage').then((module) => ({
    default: module.AnalyticsPage,
  })),
)
const OverviewPage = lazy(() =>
  import('./pages/OverviewPage').then((module) => ({ default: module.OverviewPage })),
)
const RunsPage = lazy(() =>
  import('./pages/RunsPage').then((module) => ({ default: module.RunsPage })),
)
const ScenariosPage = lazy(() =>
  import('./pages/ScenariosPage').then((module) => ({ default: module.ScenariosPage })),
)
const TopologyPage = lazy(() =>
  import('./pages/TopologyPage').then((module) => ({ default: module.TopologyPage })),
)
const TaskDetail = lazy(() =>
  import('./TaskDetail').then((module) => ({ default: module.TaskDetail })),
)

function RequireAuth({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const token = getToken()

  useLayoutEffect(() => {
    if (!getToken()) {
      navigate('/', { replace: true, state: { from: location.pathname } })
    }
  }, [navigate, location.pathname, location.search, token])

  if (!token) {
    return null
  }
  return <>{children}</>
}

function RouteFallback() {
  return (
    <Card className="border-border/70">
      <CardContent className="p-6 text-sm text-muted-foreground">
        Загрузка раздела…
      </CardContent>
    </Card>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <Suspense fallback={<RouteFallback />}>
                <PlatformLayout />
              </Suspense>
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/app/overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="scenarios" element={<ScenariosPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="topology" element={<TopologyPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
        <Route
          path="/app/tasks/:id"
          element={
            <RequireAuth>
              <Suspense fallback={<RouteFallback />}>
                <TaskDetail />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
