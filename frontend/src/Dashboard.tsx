import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { AgentsTableCard } from '@/features/dashboard/AgentsTableCard'
import { MetricsSection } from '@/features/dashboard/MetricsSection'
import { TaskComposerCard } from '@/features/dashboard/TaskComposerCard'
import { TasksTableCard } from '@/features/dashboard/TasksTableCard'
import { TemplatesCard } from '@/features/dashboard/TemplatesCard'
import { AnalyticsPanel } from '@/features/insights/AnalyticsPanel'
import { MachineDiffPanel } from '@/features/insights/MachineDiffPanel'
import { OpsPanel } from '@/features/insights/OpsPanel'
import { TopologyPanel } from '@/features/insights/TopologyPanel'
import { TEMPLATE_LABELS } from '@/features/taskComposer/scenarios'
import { useLiveDashboard } from '@/hooks/useLiveDashboard'
import { useTaskComposerStore } from '@/stores/taskComposerStore'
import {
  api,
  canOperate,
  clearToken,
  getRole,
  setRole,
  type UserRole,
} from './api'
import { qk } from './queryKeys'

function normalizeRole(r: string): UserRole | null {
  const x = r.toLowerCase()
  if (x === 'admin' || x === 'operator' || x === 'observer') return x
  return null
}

export function Dashboard() {
  useLiveDashboard(true)
  const qc = useQueryClient()
  const {
    selectedAgentId,
    setSelectedAgentId,
    kind,
    payloadText,
    maxRetries,
  } = useTaskComposerStore()

  const meQ = useQuery({
    queryKey: qk.me,
    queryFn: api.me,
    staleTime: 60_000,
  })

  useEffect(() => {
    const r = meQ.data?.role
    if (r) {
      const n = normalizeRole(r)
      if (n) setRole(n)
    }
  }, [meQ.data?.role])

  const role = getRole()
  const operate = canOperate()

  const agentsQ = useQuery({
    queryKey: qk.agents,
    queryFn: api.agents,
    refetchInterval: 300_000,
  })

  const tasksQ = useQuery({
    queryKey: qk.tasks,
    queryFn: api.tasks,
    refetchInterval: 300_000,
  })

  const metricsQ = useQuery({
    queryKey: qk.metrics,
    queryFn: api.metricsSummary,
    refetchInterval: 300_000,
  })

  const agents = useMemo(() => agentsQ.data ?? [], [agentsQ.data])

  useEffect(() => {
    if (agents.length === 0) return
    if (!selectedAgentId || !agents.some((a) => a.id === selectedAgentId)) {
      setSelectedAgentId(agents[0].id)
    }
  }, [agents, selectedAgentId, setSelectedAgentId])

  const agentId =
    selectedAgentId && agents.some((a) => a.id === selectedAgentId)
      ? selectedAgentId
      : agents[0]?.id ?? ''

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
      api.createTask(agentId, 'check_bundle', { template }, maxRetries),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tasks })
      qc.invalidateQueries({ queryKey: qk.metrics })
    },
  })

  const loadErr =
    (agentsQ.error ?? tasksQ.error) instanceof Error
      ? (agentsQ.error ?? tasksQ.error)?.message
      : agentsQ.isError || tasksQ.isError
        ? 'Ошибка загрузки'
        : null

  const createErr =
    createTask.error instanceof Error
      ? createTask.error.message
      : createTask.isError
        ? 'Ошибка'
        : null

  const roleLabel =
    role === 'admin'
      ? 'Администратор'
      : role === 'observer'
        ? 'Наблюдатель'
        : 'Оператор'

  return (
    <AppShell
      title="InfraHub"
      subtitle="Панель управления агентами: проверки, аналитика, топология и экспорт. Обновления по SSE при событиях; редкий опрос — подстраховка."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {role && (
            <Badge variant="secondary" className="font-normal">
              {roleLabel}
            </Badge>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              clearToken()
              window.location.href = '/'
            }}
          >
            Выйти
          </Button>
        </div>
      }
    >
      <Tabs defaultValue="panel" className="w-full">
        <TabsList className="mb-6 flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/50 p-1">
          <TabsTrigger value="panel">Панель</TabsTrigger>
          <TabsTrigger value="analytics">Аналитика</TabsTrigger>
          <TabsTrigger value="topology">Топология</TabsTrigger>
          <TabsTrigger value="diff">Сравнение узлов</TabsTrigger>
          <TabsTrigger value="ops">Экспорт и админ</TabsTrigger>
        </TabsList>

        <TabsContent value="panel" className="flex flex-col gap-6">
          {loadErr && (
            <p className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {loadErr}
            </p>
          )}

          <MetricsSection metrics={metricsQ.data ?? null} isLoading={metricsQ.isLoading} />

          <AgentsTableCard
            agents={agents}
            loading={agentsQ.isLoading}
            canEditMeta={operate}
          />

          <TemplatesCard
            labels={TEMPLATE_LABELS}
            disabled={!operate || !agentId}
            pending={runTemplate.isPending}
            onRun={(t) => runTemplate.mutate(t)}
          />

          {runTemplate.isError && (
            <p className="text-sm text-destructive">
              {runTemplate.error instanceof Error
                ? runTemplate.error.message
                : 'Ошибка шаблона'}
            </p>
          )}

          <TaskComposerCard
            agents={agents}
            agentId={agentId}
            onSubmitTask={() => createTask.mutate()}
            submitting={createTask.isPending}
            submitError={createErr}
            readOnly={!operate}
          />

          <TasksTableCard tasks={tasksQ.data ?? []} loading={tasksQ.isLoading} />
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsPanel />
        </TabsContent>

        <TabsContent value="topology">
          <TopologyPanel />
        </TabsContent>

        <TabsContent value="diff">
          <MachineDiffPanel />
        </TabsContent>

        <TabsContent value="ops">
          <OpsPanel />
        </TabsContent>
      </Tabs>
    </AppShell>
  )
}
