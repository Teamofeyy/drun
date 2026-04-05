import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, Boxes, Cable, LayoutList, Server, Upload } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MetricsSection } from '@/features/dashboard/MetricsSection'
import { TasksTableCard } from '@/features/dashboard/TasksTableCard'
import { AgentStatusGrid } from '@/features/overview/AgentStatusGrid'
import { api } from '@/api'
import { qk } from '@/queryKeys'

export function OverviewPage() {
  const tasksQ = useQuery({ queryKey: qk.tasks, queryFn: api.tasks, refetchInterval: 300_000 })
  const metricsQ = useQuery({
    queryKey: qk.metrics,
    queryFn: api.metricsSummary,
    refetchInterval: 300_000,
  })
  const scenariosQ = useQuery({ queryKey: qk.scenarios, queryFn: api.scenarios, refetchInterval: 60_000 })

  const recentTasks = (tasksQ.data ?? []).slice(0, 8)

  return (
    <div className="flex flex-col gap-4">
      <MetricsSection metrics={metricsQ.data ?? null} isLoading={metricsQ.isLoading} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="border-border/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Дальше что делать</CardTitle>
              <CardDescription>
                Частые шаги. Остальные разделы — в меню слева.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              <Button asChild variant="default" className="h-auto justify-between gap-3 py-3">
                <Link to="/app/runs">
                  <span className="flex items-center gap-2 text-left">
                    <LayoutList className="size-4 shrink-0 opacity-90" />
                    <span>
                      <span className="block font-medium">Запустить проверку</span>
                      <span className="block text-xs font-normal opacity-90">Очередь и новые run</span>
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 opacity-80" />
                </Link>
              </Button>
              <Button asChild variant="secondary" className="h-auto justify-between gap-3 py-3">
                <Link to="/app/scenarios">
                  <span className="flex items-center gap-2 text-left">
                    <Boxes className="size-4 shrink-0 opacity-90" />
                    <span>
                      <span className="block font-medium">Сценарии</span>
                      <span className="block text-xs font-normal opacity-90">
                        {scenariosQ.isLoading
                          ? 'Загрузка…'
                          : `${scenariosQ.data?.length ?? 0} в библиотеке`}
                      </span>
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 opacity-80" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-auto justify-between gap-3 py-3">
                <Link to="/app/agents">
                  <span className="flex items-center gap-2 text-left">
                    <Server className="size-4 shrink-0 opacity-90" />
                    <span>
                      <span className="block font-medium">Агенты</span>
                      <span className="block text-xs font-normal opacity-90">
                        Статусы и массовая загрузка
                      </span>
                    </span>
                  </span>
                  <Upload className="size-4 shrink-0 opacity-80" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-auto justify-between gap-3 py-3">
                <Link to="/app/topology">
                  <span className="flex items-center gap-2 text-left">
                    <Cable className="size-4 shrink-0 opacity-90" />
                    <span>
                      <span className="block font-medium">Топология</span>
                      <span className="block text-xs font-normal opacity-90">Связи и карта</span>
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 opacity-80" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <AgentStatusGrid />
        </div>

        <Card className="border-border/70 xl:min-h-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Последние задачи</CardTitle>
            <CardDescription>Недавние постановки в очередь.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <TasksTableCard tasks={recentTasks} loading={tasksQ.isLoading} embedded />
            <div className="flex justify-end">
              <Button asChild size="sm" variant="outline">
                <Link to="/app/runs">
                  Все задачи
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
