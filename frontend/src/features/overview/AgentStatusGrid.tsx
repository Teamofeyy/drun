import { Heart, HeartCrack } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, type Agent } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { qk } from '@/queryKeys'
import { useQuery } from '@tanstack/react-query'
import { agentStatusLabel, formatRelative } from '@/utils/format'
import { cn } from '@/lib/utils'

function dotClass(status: string) {
  if (status === 'online') return 'bg-emerald-500'
  if (status === 'busy') return 'bg-amber-400'
  return 'bg-slate-400'
}

function agentIsLive(status: string) {
  return status === 'online' || status === 'busy'
}

function HeartbeatMetaSlot({
  value,
  live,
}: {
  value: string | null | undefined
  live: boolean
}) {
  const v = value?.trim()
  if (v) {
    return <span className="min-w-0 truncate">{v}</span>
  }
  const Icon = live ? Heart : HeartCrack
  return (
    <Icon
      className={cn(
        'size-2.5 shrink-0',
        live ? 'text-muted-foreground/80' : 'text-muted-foreground/45',
      )}
      aria-hidden
    />
  )
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Link
      to="/app/agents"
      className={cn(
        'flex flex-col gap-1 rounded-xl border border-border/70 bg-card/80 p-3 shadow-sm transition-colors',
        'hover:border-primary/30 hover:bg-muted/20',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('size-2.5 shrink-0 rounded-full', dotClass(agent.status))} />
          <p className="truncate text-sm font-semibold">{agent.name}</p>
        </div>
        <Badge variant="outline" className="shrink-0 text-xs">
          {agentStatusLabel(agent.status)}
        </Badge>
      </div>
      <div
        className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
        aria-label={
          agentIsLive(agent.status)
            ? 'Метаданные агента, пустые поля — активный heartbeat'
            : 'Метаданные агента, пустые поля — нет связи'
        }
      >
        <HeartbeatMetaSlot value={agent.site} live={agentIsLive(agent.status)} />
        <span className="shrink-0 opacity-50" aria-hidden>
          ·
        </span>
        <HeartbeatMetaSlot value={agent.segment} live={agentIsLive(agent.status)} />
        <span className="shrink-0 opacity-50" aria-hidden>
          ·
        </span>
        <HeartbeatMetaSlot value={agent.role_tag} live={agentIsLive(agent.status)} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {agent.last_seen_at ? formatRelative(agent.last_seen_at) : 'Нет heartbeat'}
      </p>
    </Link>
  )
}

export function AgentStatusGrid() {
  const agentsQ = useQuery({ queryKey: qk.agents, queryFn: api.agents, refetchInterval: 300_000 })
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
