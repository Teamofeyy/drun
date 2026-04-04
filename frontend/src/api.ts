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
  createTask(agent_id: string, kind: string, payload: unknown) {
    return apiFetch('/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({ agent_id, kind, payload }),
    }) as Promise<Task>
  },
  task(id: string) {
    return apiFetch(`/api/v1/tasks/${id}`) as Promise<Task>
  },
  taskResult(id: string) {
    return apiFetch(`/api/v1/tasks/${id}/result`) as Promise<TaskResult>
  },
  taskLogs(id: string) {
    return apiFetch(`/api/v1/tasks/${id}/logs`) as Promise<TaskLog[]>
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
}

export type TaskResult = {
  id: string
  task_id: string
  stdout: string | null
  stderr: string | null
  exit_code: number | null
  data: unknown
  created_at: string
}

export type TaskLog = {
  id: number
  task_id: string
  ts: string
  level: string
  message: string
}
