const TOKEN_KEY = 'infrahub_token'
const ROLE_KEY = 'infrahub_role'

export type UserRole = 'admin' | 'operator' | 'observer'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t)
}

export function setRole(r: string) {
  localStorage.setItem(ROLE_KEY, r)
}

export function getRole(): UserRole | null {
  const r = localStorage.getItem(ROLE_KEY)
  if (r === 'admin' || r === 'operator' || r === 'observer') return r
  return null
}

export function canOperate(): boolean {
  const r = getRole()
  return r === 'admin' || r === 'operator'
}

export function isAdmin(): boolean {
  return getRole() === 'admin'
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(ROLE_KEY)
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const token = getToken()
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(path, { ...init, headers })
  if (res.status === 401) {
    clearToken()
    window.location.href = '/'
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    const msg = (j as { error?: string }).error ?? res.statusText
    throw new Error(msg)
  }
  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  return JSON.parse(text)
}

async function apiFetchMaybe(path: string): Promise<unknown | null> {
  const token = getToken()
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(path, { headers })
  if (res.status === 404) return null
  if (res.status === 401) {
    clearToken()
    window.location.href = '/'
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    const msg = (j as { error?: string }).error ?? res.statusText
    throw new Error(msg)
  }
  const text = await res.text()
  if (!text) return null
  return JSON.parse(text)
}

export async function downloadExport(format: 'json' | 'csv' | 'pdf') {
  const token = getToken()
  const res = await fetch(`/api/v1/export/tasks?format=${format}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (res.status === 401) {
    clearToken()
    window.location.href = '/'
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || res.statusText)
  }
  const blob = await res.blob()
  const ext = format === 'pdf' ? 'pdf' : format === 'csv' ? 'csv' : 'json'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `infrahub-tasks.${ext}`
  a.click()
  URL.revokeObjectURL(url)
}

export type ProvisionAgentRequest = {
  host: string
  ssh_user: string
  ssh_port?: number
  infrahub_api_base: string
  /** Если не передать — backend подставит значение из конфигурации сервера. */
  infrahub_agent_release_base?: string | null
  private_key_pem?: string | null
  ssh_password?: string | null
}

export type ProvisionAgentDefaultsResponse = {
  infrahub_agent_release_base: string
}

export type UninstallAgentRequest = {
  host: string
  ssh_user: string
  ssh_port?: number
  /** Если задан — после успешного снятия с ноды удаляется запись агента (топология обновится). */
  remove_agent_id?: string | null
  private_key_pem?: string | null
  ssh_password?: string | null
}

export type ProvisionAgentResponse = {
  ok: boolean
  exit_code: number | null
  stdout: string
  stderr: string
  message: string
}

/** Значения по умолчанию для установки агента (каталог релиза задаётся на сервере). */
export function fetchProvisionAgentDefaults(): Promise<ProvisionAgentDefaultsResponse> {
  return apiFetch('/api/v1/admin/provision-agent-defaults') as Promise<ProvisionAgentDefaultsResponse>
}

/** Установка агента по SSH (также доступно как `api.provisionAgent`). */
export function provisionAgent(
  body: ProvisionAgentRequest,
): Promise<ProvisionAgentResponse> {
  return apiFetch('/api/v1/admin/provision-agent', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as Promise<ProvisionAgentResponse>
}

export function uninstallAgent(
  body: UninstallAgentRequest,
): Promise<ProvisionAgentResponse> {
  return apiFetch('/api/v1/admin/uninstall-agent', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as Promise<ProvisionAgentResponse>
}

export const api = {
  login(username: string, password: string) {
    return apiFetch('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }) as Promise<{ token: string; role: string }>
  },
  me() {
    return apiFetch('/api/v1/me') as Promise<MeResponse>
  },
  agents() {
    return apiFetch('/api/v1/agents') as Promise<Agent[]>
  },
  patchAgent(
    id: string,
    body: { site?: string; segment?: string; role_tag?: string },
  ) {
    return apiFetch(`/api/v1/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as Promise<Agent>
  },
  tasks() {
    return apiFetch('/api/v1/tasks') as Promise<Task[]>
  },
  createTask(
    agent_id: string,
    kind: string,
    payload: unknown,
    max_retries?: number,
  ) {
    return apiFetch('/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        agent_id,
        kind,
        payload,
        ...(max_retries !== undefined ? { max_retries } : {}),
      }),
    }) as Promise<Task>
  },
  metricsSummary() {
    return apiFetch('/api/v1/metrics/summary') as Promise<MetricsSummary>
  },
  analyticsDaily(days?: number) {
    const q = days != null ? `?days=${days}` : ''
    return apiFetch(`/api/v1/analytics/daily${q}`) as Promise<DailyAnalytics>
  },
  analyticsRanking(days?: number) {
    const q = days != null ? `?days=${days}` : ''
    return apiFetch(`/api/v1/analytics/ranking${q}`) as Promise<RankingResponse>
  },
  analyticsGroups() {
    return apiFetch('/api/v1/analytics/groups') as Promise<GroupsResponse>
  },
  topologyGraph() {
    return apiFetch('/api/v1/topology/graph') as Promise<TopologyGraph>
  },
  provisionAgent,
  fetchProvisionAgentDefaults,
  uninstallAgent,
  machineDiff(agentId: string, fromTask: string, toTask: string) {
    return apiFetch(
      `/api/v1/agents/${agentId}/machine-diff?from_task=${encodeURIComponent(fromTask)}&to_task=${encodeURIComponent(toTask)}`,
    ) as Promise<MachineDiffResponse>
  },
  clearTaskHistory() {
    return apiFetch('/api/v1/admin/clear-task-history', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'DELETE_ALL_TASK_HISTORY' }),
    }) as Promise<{
      ok: boolean
      deleted_task_rows: number
      redis_queue_keys_cleared: number
    }>
  },
  task(id: string) {
    return apiFetch(`/api/v1/tasks/${id}`) as Promise<Task>
  },
  taskResult(id: string) {
    return apiFetch(`/api/v1/tasks/${id}/result`) as Promise<TaskResult>
  },
  taskResultMaybe(id: string) {
    return apiFetchMaybe(`/api/v1/tasks/${id}/result`) as Promise<TaskResult | null>
  },
  taskLogsMaybe(id: string) {
    return apiFetchMaybe(`/api/v1/tasks/${id}/logs`) as Promise<TaskLog[] | null>
  },
}

export type MeResponse = {
  id: string
  username: string
  role: string
}

export type Agent = {
  id: string
  name: string
  created_at: string
  last_seen_at: string | null
  status: string
  site: string
  segment: string
  role_tag: string
}

export type Task = {
  id: string
  agent_id: string
  kind: string
  payload: unknown
  status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  retries_used: number
  max_retries: number
}

export type TaskResult = {
  id: string
  task_id: string
  stdout: string | null
  stderr: string | null
  exit_code: number | null
  data: unknown
  summary: string | null
  created_at: string
}

export type MetricsSummary = {
  window_hours: number
  tasks_by_status: Record<string, number>
  avg_duration_seconds_done: number | null
  agents_total: number
  agents_online: number
}

export type TaskLog = {
  id: number
  task_id: string
  ts: string
  level: string
  message: string
}

export type DailySeriesRow = {
  day: string
  agent_id: string
  agent_name: string
  runs: number
  errors: number
  avg_duration_seconds: number | null
}

export type DailyAnalytics = {
  days_window: number
  series: DailySeriesRow[]
}

export type RankingEntry = {
  agent_id: string
  name: string
  finished_tasks: number
  failed_tasks: number
  success_rate: number
  avg_duration_seconds: number | null
  stability_score: number
  speed_score: number
  combined_score: number
}

export type RankingResponse = {
  days_window: number
  ranking: RankingEntry[]
}

export type GroupsResponse = {
  by_site: Record<string, number>
  by_segment: Record<string, number>
  by_role_tag: Record<string, number>
}

export type TopologyNode = {
  id: string
  label: string
  type: string
  site?: string
  segment?: string
  role_tag?: string
  sub?: string
}

export type TopologyEdge = {
  source: string
  target: string
  kind: string
  category?: string
  detail?: string
}

export type TopologyGraph = {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  legend?: {
    control_plane: string
    metadata: string
    observed_probe: string
  }
}

export type MachineDiffChange = {
  path: string
  before: unknown
  after: unknown
  change: string
}

export type MachineDiffResponse = {
  agent_id: string
  from_task: string
  to_task: string
  changes: MachineDiffChange[]
  changed_count: number
}
