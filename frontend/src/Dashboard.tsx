import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, clearToken } from './api'
import type { Agent, Task } from './api'

const KINDS = [
  'system_info',
  'port_check',
  'diagnostic',
  'network_reachability',
] as const

export function Dashboard() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [agentId, setAgentId] = useState('')
  const [kind, setKind] = useState<(typeof KINDS)[number]>('system_info')
  const [payloadText, setPayloadText] = useState('{}')

  async function load() {
    setErr(null)
    try {
      const [a, t] = await Promise.all([api.agents(), api.tasks()])
      setAgents(a)
      setTasks(t)
      setAgentId((prev) => prev || (a[0]?.id ?? ''))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 8000)
    return () => clearInterval(id)
  }, [])

  async function createTask(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    let payload: unknown = {}
    try {
      payload = JSON.parse(payloadText || '{}')
    } catch {
      setErr('payload: невалидный JSON')
      return
    }
    try {
      await api.createTask(agentId, kind, payload)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed')
    }
  }

  function preset(kind: (typeof KINDS)[number]) {
    setKind(kind)
    if (kind === 'port_check') {
      setPayloadText(
        JSON.stringify(
          { targets: [{ host: '127.0.0.1', port: 8080 }] },
          null,
          2,
        ),
      )
    } else if (kind === 'diagnostic') {
      setPayloadText(JSON.stringify({ scenario: 'uname' }, null, 2))
    } else if (kind === 'network_reachability') {
      setPayloadText(
        JSON.stringify({ targets: ['127.0.0.1:8080'] }, null, 2),
      )
    } else {
      setPayloadText('{}')
    }
  }

  return (
    <div className="layout">
      <header className="topbar">
        <h1>InfraHub</h1>
        <button
          type="button"
          onClick={() => {
            clearToken()
            window.location.href = '/'
          }}
        >
          Выйти
        </button>
      </header>

      {err && <p className="error banner">{err}</p>}

      <section className="panel">
        <h2>Агенты</h2>
        <table>
          <thead>
            <tr>
              <th>Имя</th>
              <th>Статус</th>
              <th>Последний heartbeat</th>
              <th>ID</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>
                  <span className={`pill ${a.status}`}>{a.status}</span>
                </td>
                <td>{a.last_seen_at ?? '—'}</td>
                <td className="mono">{a.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Новая задача</h2>
        <p className="muted">
          Типы: только whitelist на сервере. Payload — JSON.
        </p>
        <form onSubmit={createTask} className="stack">
          <label>
            Агент
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Тип
            <select
              value={kind}
              onChange={(e) => {
                const k = e.target.value as (typeof KINDS)[number]
                preset(k)
              }}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payload (JSON)
            <textarea
              rows={8}
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              className="mono"
            />
          </label>
          <button type="submit">Поставить в очередь</button>
        </form>
      </section>

      <section className="panel">
        <h2>Задачи</h2>
        <table>
          <thead>
            <tr>
              <th>Создана</th>
              <th>Тип</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>{t.created_at}</td>
                <td>{t.kind}</td>
                <td>{t.status}</td>
                <td>
                  <Link to={`/app/tasks/${t.id}`}>детали</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
