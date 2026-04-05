import { Link } from 'react-router-dom'
import { api, type Agent } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { qk } from '@/queryKeys'
import { useQuery } from '@tanstack/react-query'
import { formatRelative } from '@/utils/format'
import { cn } from '@/lib/utils'

function dotClass(status: string) {
  if (status === 'online') return 'bg-emerald-500'
  if (status === 'busy') return 'bg-amber-400'
  return 'bg-slate-400'
}

function statusLabel(status: string) {
  if (status === 'busy') return 'busy'
  return status
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border/70 bg-card/80 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('size-2.5 rounded-full', dotClass(agent.status))} />
          <p className="truncate text-sm font-semibold">{agent.name}</p>
        </div>
        <Badge variant="outline" className="text-xs">
          {statusLabel(agent.status)}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground truncate">
        {agent.site || '—'} · {agent.segment || '—'} · {agent.role_tag || '—'}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {agent.last_seen_at ? formatRelative(agent.last_seen_at) : 'нет heartbeat'}
      </p>
    </div>
  )
}

export function AgentStatusGrid() {
  const agentsQ = useQuery({ queryKey: qk.agents, queryFn: api.agents, refetchInterval: 15_000 })
  const agents = (agentsQ.data ?? []).slice(0, 9)

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg">Агенты</CardTitle>
            <CardDescription>Статусы и heartbeat в одном экране.</CardDescription>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/app/agents">Открыть</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет зарегистрированных агентов.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
