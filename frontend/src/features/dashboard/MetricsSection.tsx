import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { taskStatusLabel } from '@/utils/format'
import { cn } from '@/lib/utils'

export type DashboardMetrics = {
  agents_online: number
  agents_total: number
  avg_duration_seconds_done: number | null
  tasks_by_status: Record<string, number>
}

const TASK_STATUS_ORDER = ['running', 'pending', 'done', 'failed'] as const

function skeletonTile() {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
      <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      <div className="mt-3 h-8 w-16 animate-pulse rounded bg-muted" />
    </div>
  )
}

export function MetricsSection({
  metrics,
  isLoading,
}: {
  metrics: DashboardMetrics | null
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Состояние (24 ч)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {skeletonTile()}
            {skeletonTile()}
            {skeletonTile()}
            {skeletonTile()}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!metrics) {
    return (
      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Состояние (24 ч)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Не удалось загрузить метрики.</p>
        </CardContent>
      </Card>
    )
  }

  const entries = Object.entries(metrics.tasks_by_status).filter(([, v]) => v > 0)
  entries.sort((a, b) => {
    const ia = TASK_STATUS_ORDER.indexOf(a[0] as (typeof TASK_STATUS_ORDER)[number])
    const ib = TASK_STATUS_ORDER.indexOf(b[0] as (typeof TASK_STATUS_ORDER)[number])
    const sa = ia === -1 ? 99 : ia
    const sb = ib === -1 ? 99 : ib
    if (sa !== sb) return sa - sb
    return a[0].localeCompare(b[0])
  })

  const failedCount = metrics.tasks_by_status.failed ?? 0

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Состояние (24 ч)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Агенты онлайн
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {metrics.agents_online} / {metrics.agents_total}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Среднее время (готово)
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {metrics.avg_duration_seconds_done != null
                ? `${metrics.avg_duration_seconds_done.toFixed(1)} с`
                : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Задачи по статусу
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entries.length === 0 ? (
                <span className="text-sm text-muted-foreground">Нет задач за период</span>
              ) : (
                entries.map(([k, v]) => (
                  <Badge
                    key={k}
                    variant={k === 'failed' ? 'destructive' : 'secondary'}
                    className="tabular-nums"
                  >
                    {taskStatusLabel(k)} · {v}
                  </Badge>
                ))
              )}
            </div>
          </div>
          <div
            className={cn(
              'rounded-lg border px-3 py-3',
              failedCount > 0
                ? 'border-destructive/40 bg-destructive/5'
                : 'border-border/70 bg-muted/30',
            )}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Задачи с ошибкой
            </p>
            <p
              className={cn(
                'mt-1 text-xl font-semibold tabular-nums',
                failedCount > 0 && 'text-destructive',
              )}
            >
              {failedCount}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {failedCount === 0 ? 'За последние 24 ч ошибок нет' : 'Требуют внимания'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
