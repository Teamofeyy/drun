import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Metrics = {
  agents_online: number
  agents_total: number
  avg_duration_seconds_done: number | null
  tasks_by_status: Record<string, number>
}

export function MetricsSection({ metrics }: { metrics: Metrics }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Метрики (24 ч)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Агенты онлайн
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {metrics.agents_online} / {metrics.agents_total}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Среднее время задачи (done)
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {metrics.avg_duration_seconds_done != null
                ? `${metrics.avg_duration_seconds_done.toFixed(1)} с`
                : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4 sm:col-span-2 lg:col-span-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Задачи по статусу
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {Object.entries(metrics.tasks_by_status)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ') || 'нет данных'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
