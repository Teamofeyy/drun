import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AgentsTableCard } from '@/features/dashboard/AgentsTableCard'
import { AgentBulkUploadCard } from '@/features/agents/AgentBulkUploadCard'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { api, canOperate, fetchProvisionAgentDefaults } from '@/api'
import { qk } from '@/queryKeys'

export function AgentsPage() {
  const qc = useQueryClient()
  const agentsQ = useQuery({
    queryKey: qk.agents,
    queryFn: api.agents,
    refetchInterval: 300_000,
  })
  const scenariosQ = useQuery({
    queryKey: qk.scenarios,
    queryFn: api.scenarios,
  })

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const agents = agentsQ.data ?? []

  const upgradeScenarioId = useMemo(
    () => scenariosQ.data?.find((s) => s.slug === 'agent-self-upgrade')?.id,
    [scenariosQ.data],
  )

  const checkVersionMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const agent_id of ids) {
        await api.createTask(agent_id, 'system_info', {})
      }
    },
    onSuccess: (_data, ids) => {
      toast.success(
        `Создано задач system_info: ${ids.length}. Смотрите раздел «Задачи».`,
      )
      qc.invalidateQueries({ queryKey: qk.tasks })
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : 'Не удалось создать задачи'),
  })

  const upgradeAgentsMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!upgradeScenarioId) {
        throw new Error('Сценарий agent-self-upgrade не найден (нужен пресет на сервере)')
      }
      const defaults = await fetchProvisionAgentDefaults()
      const release_base = defaults.infrahub_agent_release_base?.trim()
      if (!release_base) {
        throw new Error('На сервере не задан INFRAHUB_AGENT_RELEASE_BASE')
      }
      for (const agent_id of ids) {
        await api.runScenario(upgradeScenarioId, {
          agent_id,
          inputs: { release_base },
        })
      }
    },
    onSuccess: (_data, ids) => {
      toast.success(
        `Запущено обновление агентов: ${ids.length} сценариев поставлено в очередь.`,
      )
      qc.invalidateQueries({ queryKey: qk.tasks })
      qc.invalidateQueries({ queryKey: qk.agents })
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : 'Ошибка запуска обновления'),
  })

  const selectedAgents = useMemo(
    () => agents.filter((agent) => selectedIds.includes(agent.id)),
    [agents, selectedIds],
  )

  function toggleAgent(agentId: string, checked: boolean) {
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(agentId) ? current : [...current, agentId]
      }
      return current.filter((id) => id !== agentId)
    })
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? agents.map((agent) => agent.id) : [])
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <AgentsTableCard
        agents={agents}
        loading={agentsQ.isLoading}
        canEditMeta={canOperate()}
        selectedIds={selectedIds}
        onToggleAgent={toggleAgent}
        onToggleAll={toggleAll}
      />

      <div className="space-y-6">
        {canOperate() && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Версия и обновление</CardTitle>
              <CardDescription>
                Для выбранных агентов в таблице: проверка через задачу{' '}
                <span className="font-mono text-xs">system_info</span> (поле{' '}
                <span className="font-mono text-xs">infrahub_agent_version</span>
                ), обновление — пресет-сценарий{' '}
                <span className="font-mono text-xs">agent-self-upgrade</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={
                  selectedIds.length === 0 ||
                  checkVersionMutation.isPending
                }
                onClick={() => checkVersionMutation.mutate(selectedIds)}
              >
                Проверить актуальную версию
              </Button>
              <Button
                type="button"
                disabled={
                  selectedIds.length === 0 ||
                  !upgradeScenarioId ||
                  upgradeAgentsMutation.isPending ||
                  scenariosQ.isLoading
                }
                onClick={() => upgradeAgentsMutation.mutate(selectedIds)}
              >
                Обновить агентов
              </Button>
            </CardContent>
          </Card>
        )}

        <AgentBulkUploadCard
          agents={agents}
          selectedIds={selectedIds}
          readOnly={!canOperate()}
        />

        <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          Выбрано: <strong className="text-foreground">{selectedAgents.length}</strong>
          {selectedAgents.length > 0 ? (
            <span> · {selectedAgents.map((agent) => agent.name).join(', ')}</span>
          ) : (
            <span> · отметьте агентов в таблице слева</span>
          )}
        </div>
      </div>
    </div>
  )
}
