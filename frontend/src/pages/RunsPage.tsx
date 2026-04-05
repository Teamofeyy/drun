import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CardDescription } from '@/components/ui/card'
import { TemplatesCard } from '@/features/dashboard/TemplatesCard'
import { TaskComposerCard } from '@/features/dashboard/TaskComposerCard'
import { TasksTableCard } from '@/features/dashboard/TasksTableCard'
import { TEMPLATE_LABELS } from '@/features/taskComposer/scenarios'
import { useTaskComposerStore } from '@/stores/taskComposerStore'
import { api, canOperate } from '@/api'
import { qk } from '@/queryKeys'

export function RunsPage() {
  const qc = useQueryClient()
  const { selectedAgentId, setSelectedAgentId, kind, payloadText, maxRetries } = useTaskComposerStore()

  const agentsQ = useQuery({ queryKey: qk.agents, queryFn: api.agents, refetchInterval: 300_000 })
  const tasksQ = useQuery({ queryKey: qk.tasks, queryFn: api.tasks, refetchInterval: 300_000 })

  const agents = agentsQ.data ?? []

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
    mutationFn: (template: string) => api.createTask(agentId, 'check_bundle', { template }, maxRetries),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tasks })
      qc.invalidateQueries({ queryKey: qk.metrics })
    },
  })

  const operate = canOperate()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 rounded-xl border border-border/70 bg-card/70 px-4 py-3 shadow-sm">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Runs и проверки
          </p>
          <CardDescription className="max-w-3xl">
            Запуск встроенных проверок и кастомных payload, пока идёт миграция к сценариям.
          </CardDescription>
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="min-w-0 space-y-3">
          <TaskComposerCard
            agents={agents}
            agentId={agentId}
            onSubmitTask={() => createTask.mutate()}
            submitting={createTask.isPending}
            submitError={
              createTask.error instanceof Error
                ? createTask.error.message
                : createTask.isError
                  ? 'Ошибка'
                  : null
            }
            readOnly={!operate}
          />

          <TemplatesCard
            labels={TEMPLATE_LABELS}
            disabled={!operate || !agentId}
            pending={runTemplate.isPending}
            onRun={(t) => runTemplate.mutate(t)}
          />
        </div>

        <div className="min-w-0">
          <TasksTableCard tasks={tasksQ.data ?? []} loading={tasksQ.isLoading} />
        </div>
      </div>
    </div>
  )
}
