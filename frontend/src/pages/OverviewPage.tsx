import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, Cable, Upload } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MetricsSection } from '@/features/dashboard/MetricsSection'
import { TasksTableCard } from '@/features/dashboard/TasksTableCard'
import { AgentStatusGrid } from '@/features/overview/AgentStatusGrid'
import { api } from '@/api'
import { qk } from '@/queryKeys'

export function OverviewPage() {
  const tasksQ = useQuery({ queryKey: qk.tasks, queryFn: api.tasks, refetchInterval: 300_000 })
  const metricsQ = useQuery({ queryKey: qk.metrics, queryFn: api.metricsSummary, refetchInterval: 300_000 })
  const scenariosQ = useQuery({ queryKey: qk.scenarios, queryFn: api.scenarios, refetchInterval: 60_000 })

  const recentTasks = (tasksQ.data ?? []).slice(0, 8)

  return (
    <div className="flex flex-col gap-4">
      {metricsQ.data && <MetricsSection metrics={metricsQ.data} />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)]">
        <div className="space-y-3">
          <AgentStatusGrid />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="border-border/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Быстрые действия</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button asChild variant="secondary" className="justify-between">
                  <Link to="/app/runs">
                    Запустить проверку
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-between">
                  <Link to="/app/scenarios">
                    Открыть сценарии ({scenariosQ.data?.length ?? 0})
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
            <Card className="border-border/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Операции</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button asChild variant="secondary" className="justify-between">
                  <Link to="/app/agents">
                    Массовая загрузка файла
                    <Upload className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-between">
                  <Link to="/app/topology">
                    Топология
                    <Cable className="size-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
            <Card className="border-border/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Навигация</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button asChild variant="ghost" className="justify-between">
                  <Link to="/app/analytics">
                    Аналитика
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="ghost" className="justify-between">
                  <Link to="/app/admin">
                    Администрирование
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Последние задачи</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <TasksTableCard tasks={recentTasks} loading={tasksQ.isLoading} />
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
