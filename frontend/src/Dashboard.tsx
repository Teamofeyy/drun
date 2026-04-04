import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, clearToken } from './api'
import { useLiveDashboard } from './hooks/useLiveDashboard'
import { qk } from './queryKeys'
import { formatDateTime, formatRelative, taskStatusLabel } from './utils/format'

const KINDS = [
  'system_info',
  'port_check',
  'diagnostic',
  'network_reachability',
  'check_bundle',
] as const

const TEMPLATE_LABELS: Record<string, string> = {
  node_baseline: 'Базовая диагностика узла',
  network_context: 'Сетевой контекст',
  internal_services_check: 'Внутренние сервисы (локально)',
}

export function Dashboard() {
  useLiveDashboard(true)
  const qc = useQueryClient()
  const [pickAgent, setPickAgent] = useState<string | null>(null)
  const [kind, setKind] = useState<(typeof KINDS)[number]>('system_info')
  const [payloadText, setPayloadText] = useState('{}')
  const [maxRetries, setMaxRetries] = useState(2)

  const agentsQ = useQuery({
    queryKey: qk.agents,
    queryFn: api.agents,
    refetchInterval: 30_000,
  })

  const tasksQ = useQuery({
    queryKey: qk.tasks,
    queryFn: api.tasks,
    refetchInterval: 30_000,
  })

  const metricsQ = useQuery({
    queryKey: qk.metrics,
    queryFn: api.metricsSummary,
    refetchInterval: 60_000,
  })

  const agents = agentsQ.data ?? []
  const agentId = pickAgent ?? agents[0]?.id ?? ''

  const createTask = useMutation({
    mutationFn: async () => {
      let payload: unknown = {}
      try {
        payload = JSON.parse(payloadText || '{}')
      } catch {
        throw new Error('Неверный JSON в payload')
      }
      return api.createTask(agentId, kind, payload, maxRetries)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tasks })
      qc.invalidateQueries({ queryKey: qk.metrics })
    },
  })

  const runTemplate = useMutation({
    mutationFn: (template: string) =>
      api.createTask(
        agentId,
        'check_bundle',
        { template },
        maxRetries,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tasks })
      qc.invalidateQueries({ queryKey: qk.metrics })
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!agentId) {
      createTask.reset()
      return
    }
    createTask.mutate()
  }

  function preset(next: (typeof KINDS)[number]) {
    setKind(next)
    if (next === 'port_check') {
      setPayloadText(
        JSON.stringify(
          {
            targets: [{ host: '127.0.0.1', port: 8080 }],
            timeout_secs: 5,
          },
          null,
          2,
        ),
      )
    } else if (next === 'diagnostic') {
      setPayloadText(JSON.stringify({ scenario: 'memory_disks' }, null, 2))
    } else if (next === 'network_reachability') {
      setPayloadText(
        JSON.stringify(
          { targets: ['1.1.1.1:443', '127.0.0.1:8080'], timeout_secs: 5 },
          null,
          2,
        ),
      )
    } else if (next === 'check_bundle') {
      setPayloadText(
        JSON.stringify({ template: 'node_baseline' }, null, 2),
      )
    } else {
      setPayloadText('{}')
    }
  }

  const loadErr =
    (agentsQ.error ?? tasksQ.error) instanceof Error
      ? (agentsQ.error ?? tasksQ.error)?.message
      : agentsQ.isError || tasksQ.isError
        ? 'Ошибка загрузки'
        : null

  const m = metricsQ.data

  return (
    <div className="layout">
      <header className="topbar">
        <div>
          <h1>InfraHub</h1>
          <p className="muted tagline">
            Live: SSE ~2 с + резервный polling · лимит параллельных задач на агенте
            настраивается на сервере
          </p>
        </div>
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

      {loadErr && <p className="error banner">{loadErr}</p>}

      {m && (
        <section className="panel metrics-bar">
          <h2>Метрики (24 ч)</h2>
          <div className="metrics-grid">
            <div className="metric">
              <span className="card-label">Агенты онлайн</span>
              <strong>
                {m.agents_online} / {m.agents_total}
              </strong>
            </div>
            <div className="metric">
              <span className="card-label">Среднее время задачи (done)</span>
              <strong>
                {m.avg_duration_seconds_done != null
                  ? `${m.avg_duration_seconds_done.toFixed(1)} с`
                  : '—'}
              </strong>
            </div>
            <div className="metric wide">
              <span className="card-label">Задачи по статусу</span>
              <p className="muted small">
                {Object.entries(m.tasks_by_status)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ') || 'нет данных'}
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Агенты</h2>
        <p className="muted small">
          Обновление по потоку событий с сервера (и резервный опрос).
        </p>
        {agentsQ.isLoading ? (
          <p className="muted">Загрузка…</p>
        ) : agents.length === 0 ? (
          <p className="muted">Пока нет агентов. Запустите агент на машине.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>Статус</th>
                <th>Активность</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.name}</strong>
                  </td>
                  <td>
                    <span className={`pill ${a.status}`}>{a.status}</span>
                  </td>
                  <td>
                    {a.last_seen_at ? (
                      <span title={formatDateTime(a.last_seen_at)}>
                        {formatRelative(a.last_seen_at)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="mono small">{a.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Шаблоны проверок</h2>
        <p className="muted small">
          Одна задача на агенте выполняет заранее заданный набор шагов (whitelist в
          бинарнике).
        </p>
        <div className="template-row">
          {(['node_baseline', 'network_context', 'internal_services_check'] as const).map(
            (t) => (
              <button
                key={t}
                type="button"
                className="btn-secondary"
                disabled={!agentId || runTemplate.isPending}
                onClick={() => runTemplate.mutate(t)}
                title={t}
              >
                {TEMPLATE_LABELS[t] ?? t}
              </button>
            ),
          )}
        </div>
        {runTemplate.isError && (
          <p className="error small">
            {runTemplate.error instanceof Error
              ? runTemplate.error.message
              : 'Ошибка'}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Новая задача</h2>
        <form onSubmit={onSubmit} className="stack">
          <label>
            Агент
            <select
              value={agentId}
              onChange={(e) => setPickAgent(e.target.value)}
              disabled={agents.length === 0}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Тип проверки
            <select
              value={kind}
              onChange={(e) => {
                preset(e.target.value as (typeof KINDS)[number])
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
            Повторы при ошибке агента (max_retries, 0 = без повторов)
            <input
              type="number"
              min={0}
              max={10}
              value={maxRetries}
              onChange={(e) =>
                setMaxRetries(Number.parseInt(e.target.value, 10) || 0)
              }
            />
          </label>
          <label>
            Доп. параметры (JSON)
            <textarea
              rows={8}
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              className="mono"
            />
          </label>
          {createTask.isError && (
            <p className="error">
              {createTask.error instanceof Error
                ? createTask.error.message
                : 'Ошибка'}
            </p>
          )}
          <button type="submit" disabled={!agentId || createTask.isPending}>
            {createTask.isPending ? 'Отправка…' : 'Поставить в очередь'}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Задачи</h2>
        {tasksQ.isLoading ? (
          <p className="muted">Загрузка…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Создана</th>
                <th>Тип</th>
                <th>Статус</th>
                <th>Повторы</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(tasksQ.data ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{formatDateTime(t.created_at)}</td>
                  <td>
                    <code className="kind">{t.kind}</code>
                  </td>
                  <td>
                    <span className={`pill status-${t.status}`}>
                      {taskStatusLabel(t.status)}
                    </span>
                  </td>
                  <td className="small muted" title="retries_used / max_retries">
                    {t.retries_used ?? 0}/{t.max_retries ?? 0}
                  </td>
                  <td>
                    <Link to={`/app/tasks/${t.id}`}>Открыть</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
