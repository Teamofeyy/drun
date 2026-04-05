import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AgentsTableCard } from '@/features/dashboard/AgentsTableCard'
import { AgentBulkUploadCard } from '@/features/agents/AgentBulkUploadCard'
import { api, canOperate } from '@/api'
import { qk } from '@/queryKeys'

export function AgentsPage() {
  const agentsQ = useQuery({
    queryKey: qk.agents,
    queryFn: api.agents,
    refetchInterval: 300_000,
  })

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const agents = agentsQ.data ?? []

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
