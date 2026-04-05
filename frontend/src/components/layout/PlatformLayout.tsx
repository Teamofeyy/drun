import { useQuery } from '@tanstack/react-query'
import { BarChart3, Boxes, Cable, FileCog, LayoutDashboard, LogOut, Radar, Server, Shield } from 'lucide-react'
import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api, clearToken, getRole, setRole } from '@/api'
import { qk } from '@/queryKeys'
import { useLiveDashboard } from '@/hooks/useLiveDashboard'

const NAV_ITEMS = [
  { to: '/app/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/app/agents', label: 'Agents', icon: Server },
  { to: '/app/scenarios', label: 'Scenarios', icon: Boxes },
  { to: '/app/runs', label: 'Runs', icon: Cable },
  { to: '/app/topology', label: 'Topology', icon: Radar },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/app/admin', label: 'Admin', icon: Shield },
] as const

function roleLabel(role: string | null) {
  if (role === 'admin') return 'Администратор'
  if (role === 'observer') return 'Наблюдатель'
  return 'Оператор'
}

function Sidebar() {
  return (
    <aside className="w-full border-b border-border/70 bg-card/90 backdrop-blur supports-[backdrop-filter]:backdrop-blur md:sticky md:top-0 md:h-svh md:w-64 md:border-b-0 md:border-r">
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <FileCog className="size-4.5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">InfraHub</p>
            <p className="text-xs text-muted-foreground">Scenario Platform</p>
          </div>
        </div>
      </div>
      <nav className="grid gap-1 p-3">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                isActive && 'bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary',
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

function PlatformHeader() {
  const meQ = useQuery({
    queryKey: qk.me,
    queryFn: api.me,
    staleTime: 60_000,
  })

  const role = (meQ.data?.role ?? getRole()) || null
  useEffect(() => {
    if (meQ.data?.role) {
      setRole(meQ.data.role.toLowerCase())
    }
  }, [meQ.data?.role])

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-xl border border-border/70 bg-card/80 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Централизованная диагностика
        </p>
        <h1 className="text-xl font-semibold tracking-tight">
          Платформа сценариев и запусков
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {role && <Badge variant="secondary">{roleLabel(role)}</Badge>}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            clearToken()
            window.location.href = '/'
          }}
        >
          <LogOut className="size-4" />
          Выйти
        </Button>
      </div>
    </div>
  )
}

export function PlatformLayout() {
  useLiveDashboard(true)

  return (
    <div className="min-h-svh bg-background/70 md:flex">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <AppShell className="bg-transparent">
          <PlatformHeader />
          <Outlet />
        </AppShell>
      </main>
    </div>
  )
}
