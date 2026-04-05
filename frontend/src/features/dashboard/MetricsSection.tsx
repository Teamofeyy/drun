import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Metrics = {
  agents_online: number
  agents_total: number
  avg_duration_seconds_done: number | null
  tasks_by_status: Record<string, number>
}

export function MetricsSection({ metrics }: { metrics: Metrics }) {
  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Метрики (24 ч)</CardTitle>
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
              Среднее время (done)
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
            <p className="mt-1 text-sm text-muted-foreground leading-snug">
              {Object.entries(metrics.tasks_by_status)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ') || 'нет данных'}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              SLA-сводка
            </p>
            <p className="mt-1 text-sm text-muted-foreground leading-snug">
              Онлайн {metrics.agents_online}/{metrics.agents_total}, среднее время —{' '}
              {metrics.avg_duration_seconds_done != null
                ? `${metrics.avg_duration_seconds_done.toFixed(1)} с`
                : 'нет данных'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
