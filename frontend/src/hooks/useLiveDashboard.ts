import {
  type QueryClient,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { type Agent, getToken } from '../api'
import { qk } from '../queryKeys'

const RECONNECT_MS = 4000
/** Схлопываем всплеск SSE (burst на клиенте). */
const INVALIDATE_DEBOUNCE_MS = 700

type SseKind = 'reconcile' | 'update'

type SnapshotAgent = {
  id?: unknown
  name?: unknown
  status?: unknown
  last_seen_at?: unknown
}

type SnapshotTasks = {
  error?: unknown
  agents?: unknown
  tasks?: Array<{ id?: unknown; status?: unknown }>
}

function snapshotHasActiveTasks(data: SnapshotTasks): boolean {
  if (!Array.isArray(data.tasks)) return false
  return data.tasks.some(
    (t) => t?.status === 'pending' || t?.status === 'running',
  )
}

/** Патчим кэш агентов из SSE (снимок ≤100 шт., порядок как на сервере + хвост не в снимке). */
function patchAgentsFromSnapshot(qc: QueryClient, raw: string): boolean {
  try {
    const data = JSON.parse(raw) as SnapshotTasks
    if (data.error) return false
    if (!Array.isArray(data.agents)) return false

    const rows = data.agents as SnapshotAgent[]
    qc.setQueryData<Agent[]>(qk.agents, (prev) => {
      const prevList = prev ?? []
      const byId = new Map(prevList.map((a) => [a.id, { ...a }]))
      const snapIds: string[] = []

      for (const row of rows) {
        const id =
          typeof row.id === 'string'
            ? row.id
            : row.id != null
              ? String(row.id)
              : ''
        if (!id) continue
        snapIds.push(id)
        const ex = byId.get(id)
        const name =
          typeof row.name === 'string' ? row.name : ex?.name ?? ''
        const status =
          typeof row.status === 'string' ? row.status : ex?.status ?? 'offline'
        let last_seen_at: string | null
        if (row.last_seen_at === null || row.last_seen_at === undefined) {
          last_seen_at = ex?.last_seen_at ?? null
        } else if (typeof row.last_seen_at === 'string') {
          last_seen_at = row.last_seen_at
        } else {
          last_seen_at = ex?.last_seen_at ?? null
        }

        byId.set(id, {
          id,
          name,
          status,
          last_seen_at,
          created_at: ex?.created_at ?? '',
          site: ex?.site ?? '',
          segment: ex?.segment ?? '',
          role_tag: ex?.role_tag ?? '',
        })
      }

      if (prevList.length === 0) {
        return snapIds
          .map((id) => byId.get(id))
          .filter((a): a is Agent => a != null)
      }

      const out: Agent[] = []
      const seen = new Set<string>()
      for (const id of snapIds) {
        const a = byId.get(id)
        if (a) {
          out.push(a)
          seen.add(id)
        }
      }
      for (const a of prevList) {
        if (!seen.has(a.id)) out.push(byId.get(a.id) ?? a)
      }
      return out
    })
    return true
  } catch {
    return false
  }
}

function invalidateTaskDetailsFromSnapshot(qc: QueryClient, raw: string) {
  try {
    const data = JSON.parse(raw) as SnapshotTasks
    if (!Array.isArray(data.tasks)) return
    for (const t of data.tasks) {
      const st = t?.status
      if (st !== 'pending' && st !== 'running') continue
      const id = t?.id
      if (typeof id !== 'string' || !id) continue
      void qc.invalidateQueries({ queryKey: qk.task(id) })
      void qc.invalidateQueries({ queryKey: qk.taskResult(id) })
      void qc.invalidateQueries({ queryKey: qk.taskLogs(id) })
    }
  } catch {
    /* ignore malformed snapshot */
  }
}

type LiveRoute =
  | 'topology'
  | 'overview'
  | 'agents'
  | 'runs'
  | 'scenarios'
  | 'analytics'
  | 'admin'
  | 'taskDetail'
  | 'default'

function liveRouteForPath(pathname: string): LiveRoute {
  if (pathname === '/app/topology') return 'topology'
  if (pathname === '/app/overview') return 'overview'
  if (pathname === '/app/agents') return 'agents'
  if (pathname === '/app/runs') return 'runs'
  if (pathname === '/app/scenarios') return 'scenarios'
  if (pathname === '/app/analytics') return 'analytics'
  if (pathname === '/app/admin') return 'admin'
  if (pathname.startsWith('/app/tasks/')) return 'taskDetail'
  return 'default'
}

function applyTopologyLike(
  qc: QueryClient,
  raw: string,
  _kind: SseKind,
) {
  const agentsPatched = patchAgentsFromSnapshot(qc, raw)
  if (!agentsPatched) {
    void qc.invalidateQueries({ queryKey: qk.agents })
  }
  void qc.invalidateQueries({ queryKey: qk.topology })
  try {
    const data = JSON.parse(raw) as SnapshotTasks
    if (snapshotHasActiveTasks(data)) {
      void qc.invalidateQueries({ queryKey: qk.tasks })
    }
  } catch {
    /* ignore */
  }
  invalidateTaskDetailsFromSnapshot(qc, raw)
}

function applyForLiveRoute(
  qc: QueryClient,
  route: LiveRoute,
  raw: string,
  kind: SseKind,
) {
  if (route === 'topology') {
    applyTopologyLike(qc, raw, kind)
    return
  }

  const agentsPatched = patchAgentsFromSnapshot(qc, raw)

  switch (route) {
    case 'overview': {
      if (!agentsPatched) void qc.invalidateQueries({ queryKey: qk.agents })
      void qc.invalidateQueries({ queryKey: qk.tasks })
      void qc.invalidateQueries({ queryKey: qk.metrics })
      if (kind === 'update') {
        void qc.invalidateQueries({ queryKey: qk.scenarios })
      }
      invalidateTaskDetailsFromSnapshot(qc, raw)
      return
    }
    case 'agents': {
      if (!agentsPatched) void qc.invalidateQueries({ queryKey: qk.agents })
      return
    }
    case 'runs': {
      if (!agentsPatched) void qc.invalidateQueries({ queryKey: qk.agents })
      void qc.invalidateQueries({ queryKey: qk.tasks })
      if (kind === 'update') {
        void qc.invalidateQueries({ queryKey: qk.metrics })
      }
      invalidateTaskDetailsFromSnapshot(qc, raw)
      return
    }
    case 'scenarios': {
      if (kind === 'update') {
        void qc.invalidateQueries({ queryKey: qk.scenarios })
        void qc.invalidateQueries({ queryKey: qk.tasks })
      }
      /** Список сценариев на reconcile не трогаем; детали активных задач из снимка — да. */
      invalidateTaskDetailsFromSnapshot(qc, raw)
      return
    }
    case 'analytics': {
      void qc.invalidateQueries({ queryKey: qk.analyticsDaily })
      void qc.invalidateQueries({ queryKey: qk.analyticsRanking })
      void qc.invalidateQueries({ queryKey: qk.analyticsGroups })
      return
    }
    case 'admin': {
      if (kind === 'update') {
        void qc.invalidateQueries({ queryKey: qk.tasks })
        void qc.invalidateQueries({ queryKey: qk.metrics })
      }
      return
    }
    case 'taskDetail': {
      if (!agentsPatched) void qc.invalidateQueries({ queryKey: qk.agents })
      invalidateTaskDetailsFromSnapshot(qc, raw)
      if (kind === 'update') {
        void qc.invalidateQueries({ queryKey: qk.tasks })
      } else {
        try {
          const data = JSON.parse(raw) as SnapshotTasks
          if (snapshotHasActiveTasks(data)) {
            void qc.invalidateQueries({ queryKey: qk.tasks })
          }
        } catch {
          /* ignore */
        }
      }
      return
    }
    default: {
      invalidateTaskDetailsFromSnapshot(qc, raw)
      void qc.invalidateQueries({ queryKey: qk.tasks })
      void qc.invalidateQueries({ queryKey: qk.metrics })
      if (kind === 'update') {
        void qc.invalidateQueries({ queryKey: qk.topology })
        void qc.invalidateQueries({ queryKey: qk.scenarios })
      }
      if (!agentsPatched) {
        void qc.invalidateQueries({ queryKey: qk.agents })
      }
      return
    }
  }
}

/**
 * SSE: снимок с бэкенда → патч кэша агентов и узкая инвалидация по маршруту и типу события.
 * События `reconcile` (старт, таймер ~45 с, lagged) vs `update` (push после мутаций).
 */
export function useLiveDashboard(enabled: boolean) {
  const qc = useQueryClient()
  const { pathname } = useLocation()

  useEffect(() => {
    if (!enabled) return
    const token = getToken()
    if (!token) return

    let cancelled = false
    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    let sseBatchCount = 0

    const scheduleApply = (raw: string, kind: SseKind) => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined
        if (import.meta.env.DEV) {
          sseBatchCount += 1
          console.debug(
            '[useLiveDashboard] sse batch',
            sseBatchCount,
            kind,
            'path',
            pathname,
          )
        }
        if (raw.length === 0) return
        const route = liveRouteForPath(pathname)
        applyForLiveRoute(qc, route, raw, kind)
      }, INVALIDATE_DEBOUNCE_MS)
    }

    const connect = () => {
      if (cancelled) return
      es?.close()
      const url = `/api/v1/stream/dashboard?token=${encodeURIComponent(token)}`
      es = new EventSource(url)

      const onReconcile = (ev: MessageEvent) => {
        const raw = typeof ev.data === 'string' ? ev.data : ''
        scheduleApply(raw, 'reconcile')
      }
      const onUpdate = (ev: MessageEvent) => {
        const raw = typeof ev.data === 'string' ? ev.data : ''
        scheduleApply(raw, 'update')
      }

      es.addEventListener('reconcile', onReconcile)
      es.addEventListener('update', onUpdate)
      /** Совместимость со старым бэкендом без `event:` */
      es.onmessage = (ev) => {
        const raw = typeof ev.data === 'string' ? ev.data : ''
        scheduleApply(raw, 'update')
      }

      es.onerror = () => {
        es?.close()
        es = null
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, RECONNECT_MS)
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      clearTimeout(reconnectTimer)
      clearTimeout(debounceTimer)
      es?.close()
      es = null
    }
  }, [enabled, qc, pathname])
}
