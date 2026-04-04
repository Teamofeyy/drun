import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from './api'
import { TaskResultView } from './components/TaskResultView'
import { qk } from './queryKeys'
import { formatDateTime, taskStatusLabel } from './utils/format'

export function TaskDetail() {
  const { id } = useParams<{ id: string }>()

  const taskQ = useQuery({
    queryKey: qk.task(id ?? ''),
    queryFn: () => api.task(id!),
    enabled: !!id,
    refetchInterval: (q) => {
      const st = q.state.data?.status
      return st === 'pending' || st === 'running' ? 2_500 : false
    },
  })

  const task = taskQ.data
  const doneLike = task?.status === 'done' || task?.status === 'failed'

  const resultQ = useQuery({
    queryKey: qk.taskResult(id ?? ''),
    queryFn: () => api.taskResultMaybe(id!),
    enabled: !!id && task?.status === 'done',
  })

  const logsQ = useQuery({
    queryKey: qk.taskLogs(id ?? ''),
    queryFn: () => api.taskLogsMaybe(id!),
    enabled: !!id && doneLike,
  })

  if (!id) return null

  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/app">← К списку</Link>
        <h1>Задача</h1>
      </header>

      {taskQ.isError && (
        <p className="error banner">
          {taskQ.error instanceof Error ? taskQ.error.message : 'Ошибка'}
        </p>
      )}

      {taskQ.isLoading && <p className="muted">Загрузка…</p>}

      {task && (
        <>
          <section className="panel">
            <h2>Сводка</h2>
            <div className="summary-grid">
              <div>
                <span className="card-label">Статус</span>
                <p>
                  <span className={`pill status-${task.status} large`}>
                    {taskStatusLabel(task.status)}
                  </span>
                  {(task.status === 'pending' || task.status === 'running') && (
                    <span className="live"> ● обновление каждые 2,5 с</span>
                  )}
                </p>
              </div>
              <div>
                <span className="card-label">Тип</span>
                <p>
                  <code className="kind">{task.kind}</code>
                </p>
              </div>
              <div>
                <span className="card-label">Создана</span>
                <p>{formatDateTime(task.created_at)}</p>
              </div>
              <div>
                <span className="card-label">Агент</span>
                <p className="mono small">{task.agent_id}</p>
              </div>
              {task.started_at && (
                <div>
                  <span className="card-label">Старт</span>
                  <p>{formatDateTime(task.started_at)}</p>
                </div>
              )}
              {task.completed_at && (
                <div>
                  <span className="card-label">Завершена</span>
                  <p>{formatDateTime(task.completed_at)}</p>
                </div>
              )}
              <div>
                <span className="card-label">Повторы (учёт / лимит)</span>
                <p className="muted">
                  {task.retries_used ?? 0} из {task.max_retries ?? 0} допустимых
                  повторов при ошибке
                </p>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>Результат</h2>
            <TaskResultView
              kind={task.kind}
              result={resultQ.data ?? null}
              taskError={
                task.status === 'failed' ? task.error_message : null
              }
            />
          </section>

          {logsQ.data && logsQ.data.length > 0 && (
            <section className="panel">
              <h2>Журнал выполнения</h2>
              <ul className="logs">
                {logsQ.data.map((l) => (
                  <li key={l.id}>
                    <span className="muted">{formatDateTime(l.ts)}</span>{' '}
                    <span className={`pill ${l.level}`}>{l.level}</span>{' '}
                    {l.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <details className="panel">
            <summary>Технические детали (payload задачи)</summary>
            <pre className="mono block">
              {JSON.stringify(task.payload, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  )
}
