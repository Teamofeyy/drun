import { useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  Boxes,
  Cable,
  FileCog,
  LayoutDashboard,
  LogOut,
  Radar,
  Server,
  Shield,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api, clearToken, getRole, isAdmin, setRole } from '@/api'
import { qk } from '@/queryKeys'
import { useLiveDashboard } from '@/hooks/useLiveDashboard'
import type { LucideIcon } from 'lucide-react'

/** Пиксели; миграция со старого ключа «свёрнуто» */
const SIDEBAR_WIDTH_KEY = 'infrahub_sidebar_width'
const SIDEBAR_COLLAPSED_LEGACY_KEY = 'infrahub_sidebar_collapsed'

const DEFAULT_SIDEBAR_WIDTH = 256
const MIN_SIDEBAR_WIDTH = 68
const MAX_SIDEBAR_WIDTH = 400
/** Ниже — скрываем подписи, только иконки */
const COMPACT_WIDTH_THRESHOLD = 100

type NavItem = { to: string; label: string; icon: LucideIcon }

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Обзор и запуски',
    items: [
      { to: '/app/overview', label: 'Обзор', icon: LayoutDashboard },
      { to: '/app/runs', label: 'Запуски', icon: Cable },
      { to: '/app/scenarios', label: 'Сценарии', icon: Boxes },
    ],
  },
  {
    title: 'Инфраструктура',
    items: [
      { to: '/app/agents', label: 'Агенты', icon: Server },
      { to: '/app/topology', label: 'Топология', icon: Radar },
    ],
  },
  {
    title: 'Данные',
    items: [{ to: '/app/analytics', label: 'Аналитика', icon: BarChart3 }],
  },
]

function clampSidebarWidth(n: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(n)))
}

function readInitialSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (raw != null) {
      const n = Number.parseInt(raw, 10)
      if (Number.isFinite(n)) return clampSidebarWidth(n)
    }
    if (localStorage.getItem(SIDEBAR_COLLAPSED_LEGACY_KEY) === '1') {
      return MIN_SIDEBAR_WIDTH
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SIDEBAR_WIDTH
}

function writeSidebarWidth(w: number) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(w)))
  } catch {
    /* ignore */
  }
}

function roleLabel(role: string | null) {
  if (role === 'admin') return 'Администратор'
  if (role === 'observer') return 'Наблюдатель'
  return 'Оператор'
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const fn = () => setMatches(mq.matches)
    mq.addEventListener('change', fn)
    fn()
    return () => mq.removeEventListener('change', fn)
  }, [query])
  return matches
}

function SidebarResizeHandle({
  onWidthChange,
  widthPx,
  onDoubleClickReset,
  onDragStart,
  onDragEnd,
}: {
  onWidthChange: (nextWidth: number) => void
  widthPx: number
  onDoubleClickReset: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const drag = useRef<{
    pointerId: number
    startX: number
    startWidth: number
  } | null>(null)

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      drag.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startWidth: widthPx,
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      onDragStart()
    },
    [widthPx, onDragStart],
  )

  const endDrag = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (drag.current?.pointerId !== e.pointerId) return
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      drag.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      onDragEnd()
    },
    [onDragEnd],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!drag.current || drag.current.pointerId !== e.pointerId) return
      const delta = e.clientX - drag.current.startX
      onWidthChange(clampSidebarWidth(drag.current.startWidth + delta))
    },
    [onWidthChange],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onWidthChange(clampSidebarWidth(widthPx - 8))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onWidthChange(clampSidebarWidth(widthPx + 8))
      } else if (e.key === 'Home') {
        e.preventDefault()
        onWidthChange(MIN_SIDEBAR_WIDTH)
      } else if (e.key === 'End') {
        e.preventDefault()
        onWidthChange(MAX_SIDEBAR_WIDTH)
      }
    },
    [onWidthChange, widthPx],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={widthPx}
      aria-label="Изменить ширину боковой панели"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(e) => {
        e.preventDefault()
        onDoubleClickReset()
      }}
      title="Потяните за край или дважды щёлкните для сброса ширины"
      className={cn(
        'absolute right-0 top-0 z-20 hidden h-full w-3 translate-x-1/2 cursor-col-resize md:block',
        'touch-none select-none',
        'outline-none hover:bg-primary/15 focus-visible:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80"
        aria-hidden
      />
    </div>
  )
}

function Sidebar() {
  const showAdmin = isAdmin()
  const isMd = useMediaQuery('(min-width: 768px)')
  const [widthPx, setWidthPx] = useState(readInitialSidebarWidth)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    writeSidebarWidth(widthPx)
  }, [widthPx])

  const compact = isMd && widthPx < COMPACT_WIDTH_THRESHOLD

  const setWidthClamped = useCallback((w: number) => {
    setWidthPx(clampSidebarWidth(w))
  }, [])

  return (
    <aside
      className={cn(
        'relative w-full border-b border-border/70 bg-card/90 backdrop-blur supports-backdrop-filter:backdrop-blur',
        'md:sticky md:top-0 md:flex md:h-svh md:shrink-0 md:flex-col md:border-b-0 md:border-r',
        !dragging && 'md:transition-[width] md:duration-150 md:ease-out',
      )}
      style={isMd ? { width: widthPx } : undefined}
      aria-label="Разделы приложения"
    >
      <SidebarResizeHandle
        widthPx={widthPx}
        onWidthChange={setWidthClamped}
        onDoubleClickReset={() => setWidthClamped(DEFAULT_SIDEBAR_WIDTH)}
        onDragStart={() => setDragging(true)}
        onDragEnd={() => setDragging(false)}
      />

      <div className="border-b border-border/70 px-4 py-3 md:px-2">
        <NavLink
          to="/app/overview"
          title={compact ? 'InfraHub — обзор' : undefined}
          className={cn(
            'flex items-center gap-3 rounded-lg outline-none ring-offset-background transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            compact && 'md:justify-center',
          )}
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <FileCog className="size-4.5" />
          </div>
          <div className={cn('min-w-0', compact && 'md:hidden')}>
            <p className="truncate text-sm font-semibold tracking-tight">InfraHub</p>
            <p className="text-xs text-muted-foreground">Сценарии и запуски</p>
          </div>
        </NavLink>
      </div>

      <nav
        id="app-sidebar-nav"
        className="flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-3 md:min-h-0 md:px-2"
        aria-label="Основная навигация"
      >
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="space-y-1">
            <p
              className={cn(
                'px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:px-2',
                compact && 'md:hidden',
              )}
            >
              {group.title}
            </p>
            <div className="grid gap-0.5">
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  title={compact ? label : undefined}
                  aria-label={label}
                  className={({ isActive }) =>
                    cn(
                      'flex min-w-0 items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm transition-colors md:px-2',
                      'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                      compact && 'md:justify-center',
                      isActive &&
                        'border-primary/15 bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary',
                    )
                  }
                  end={to === '/app/overview'}
                >
                  <Icon className="size-4 shrink-0 opacity-90" aria-hidden />
                  <span className={cn('truncate', compact && 'md:sr-only')}>{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}

        {showAdmin && (
          <div className="space-y-1 border-t border-border/60 pt-3">
            <p
              className={cn(
                'px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:px-2',
                compact && 'md:hidden',
              )}
            >
              Администрирование
            </p>
            <NavLink
              to="/app/admin"
              title={compact ? 'Админ-панель' : undefined}
              aria-label="Админ-панель"
              className={({ isActive }) =>
                cn(
                  'flex min-w-0 items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm transition-colors md:px-2',
                  'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                  compact && 'md:justify-center',
                  isActive &&
                    'border-primary/15 bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary',
                )
              }
            >
              <Shield className="size-4 shrink-0 opacity-90" aria-hidden />
              <span className={cn('truncate', compact && 'md:sr-only')}>Админ-панель</span>
            </NavLink>
          </div>
        )}
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
