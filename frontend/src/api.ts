const TOKEN_KEY = 'infrahub_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const token = getToken()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
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

/** 404 → null, без редиректа на логин для «ещё нет результата» */
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

export const api = {
  login(username: string, password: string) {
    return apiFetch('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }) as Promise<{ token: string }>
  },
  agents() {
    return apiFetch('/api/v1/agents') as Promise<Agent[]>
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
  task(id: string) {
    return apiFetch(`/api/v1/tasks/${id}`) as Promise<Task>
  },
  taskResult(id: string) {
    return apiFetch(`/api/v1/tasks/${id}/result`) as Promise<TaskResult>
  },
  /** null если результат ещё не записан */
  taskResultMaybe(id: string) {
    return apiFetchMaybe(`/api/v1/tasks/${id}/result`) as Promise<TaskResult | null>
  },
  taskLogsMaybe(id: string) {
    return apiFetchMaybe(`/api/v1/tasks/${id}/logs`) as Promise<TaskLog[] | null>
  },
}

export type Agent = {
  id: string
  name: string
  created_at: string
  last_seen_at: string | null
  status: string
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
