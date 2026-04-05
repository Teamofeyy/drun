import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { TaskResultView } from '@/components/TaskResultView'
import { useLiveDashboard } from '@/hooks/useLiveDashboard'
import { api } from './api'
import { qk } from './queryKeys'
import { formatDateTime, taskStatusLabel } from './utils/format'
import { cn } from '@/lib/utils'

function statusBadgeVariant(status: string) {
  switch (status) {
    case 'done':
      return 'success' as const
    case 'failed':
      return 'destructive' as const
    case 'pending':
    case 'running':
      return 'warning' as const
    default:
      return 'secondary' as const
  }
}

export function TaskDetail() {
  useLiveDashboard(true)
  const { id } = useParams<{ id: string }>()

  const taskQ = useQuery({
    queryKey: qk.task(id ?? ''),
    queryFn: () => api.task(id!),
    enabled: !!id,
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
    <AppShell
      title="Задача"
      leading={
        <Button variant="ghost" size="sm" className="h-auto p-0" asChild>
          <Link to="/app">← К панели</Link>
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        {taskQ.isError && (
          <p className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {taskQ.error instanceof Error ? taskQ.error.message : 'Ошибка'}
          </p>
        )}

        {taskQ.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        )}

        {task && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Сводка</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Статус
                    </dt>
                    <dd className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant={statusBadgeVariant(task.status)}>
                        {taskStatusLabel(task.status)}
                      </Badge>
                      {(task.status === 'pending' ||
                        task.status === 'running') && (
                        <span className="text-xs text-emerald-400">
                          ● обновление каждые 2,5 с
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Тип
                    </dt>
                    <dd className="mt-1">
                      <code
                        className={cn(
                          'rounded-md bg-muted px-2 py-0.5 font-mono text-sm',
                        )}
                      >
                        {task.kind}
                      </code>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Создана
                    </dt>
                    <dd className="mt-1 text-sm">
                      {formatDateTime(task.created_at)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Агент
                    </dt>
                    <dd className="mt-1 font-mono text-xs break-all">
                      {task.agent_id}
                    </dd>
                  </div>
                  {task.started_at && (
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Старт
                      </dt>
                      <dd className="mt-1 text-sm">
                        {formatDateTime(task.started_at)}
                      </dd>
                    </div>
                  )}
                  {task.completed_at && (
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Завершена
                      </dt>
                      <dd className="mt-1 text-sm">
                        {formatDateTime(task.completed_at)}
                      </dd>
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Повторы (учёт / лимит)
                    </dt>
                    <dd className="mt-1 text-sm text-muted-foreground">
                      {task.retries_used ?? 0} из {task.max_retries ?? 0}{' '}
                      допустимых повторов при ошибке
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Результат</CardTitle>
                <CardDescription>
                  Структурированный вывод в зависимости от типа задачи.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TaskResultView
                  kind={task.kind}
                  result={resultQ.data ?? null}
                  taskError={
                    task.status === 'failed' ? task.error_message : null
                  }
                />
              </CardContent>
            </Card>

            {logsQ.data && logsQ.data.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Журнал выполнения</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {logsQ.data.map((l) => (
                      <li key={l.id}>
                        <span className="text-muted-foreground">
                          {formatDateTime(l.ts)}
                        </span>{' '}
                        <Badge variant="outline" className="mx-1">
                          {l.level}
                        </Badge>{' '}
                        {l.message}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Технические детали (payload задачи)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="max-h-[420px] overflow-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs">
                  {JSON.stringify(task.payload, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  )
}
