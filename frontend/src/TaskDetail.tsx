import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from './api'
import type { Task, TaskLog, TaskResult } from './api'

export function TaskDetail() {
  const { id } = useParams<{ id: string }>()
  const [task, setTask] = useState<Task | null>(null)
  const [res, setRes] = useState<TaskResult | null>(null)
  const [logs, setLogs] = useState<TaskLog[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      setErr(null)
      try {
        const t = await api.task(id)
        if (cancelled) return
        setTask(t)
        try {
          const r = await api.taskResult(id)
          if (!cancelled) setRes(r)
        } catch {
          setRes(null)
        }
        try {
          const l = await api.taskLogs(id)
          if (!cancelled) setLogs(l)
        } catch {
          setLogs([])
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  if (!id) return null

  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/app">← Назад</Link>
        <h1>Задача</h1>
      </header>
      {err && <p className="error banner">{err}</p>}
      {task && (
        <section className="panel">
          <h2>Метаданные</h2>
          <pre className="mono block">{JSON.stringify(task, null, 2)}</pre>
        </section>
      )}
      {res && (
        <section className="panel">
          <h2>Результат</h2>
          <pre className="mono block">{JSON.stringify(res, null, 2)}</pre>
        </section>
      )}
      {logs.length > 0 && (
        <section className="panel">
          <h2>Логи</h2>
          <ul className="logs">
            {logs.map((l) => (
              <li key={l.id}>
                <span className="muted">{l.ts}</span>{' '}
                <span className={`pill ${l.level}`}>{l.level}</span> {l.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
