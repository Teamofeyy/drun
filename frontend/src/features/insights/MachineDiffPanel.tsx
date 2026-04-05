import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { api } from '@/api'
import { qk } from '@/queryKeys'
import { formatDateTime } from '@/utils/format'

const NO_AGENT = '__infrahub_diff_no_agent__'
const NO_TASK = '__infrahub_diff_no_task__'

export function MachineDiffPanel() {
  const agentsQ = useQuery({ queryKey: qk.agents, queryFn: api.agents })
  const tasksQ = useQuery({
    queryKey: qk.tasks,
    queryFn: api.tasks,
    /** На топологии SSE реже инвалидирует tasks (только при pending/running в снимке). */
    staleTime: 120_000,
  })

  const [agentId, setAgentId] = useState<string>('')
  const [fromId, setFromId] = useState<string>('')
  const [toId, setToId] = useState<string>('')

  const systemTasks = useMemo(() => {
    const list = tasksQ.data ?? []
    return list.filter(
      (t) =>
        t.agent_id === agentId &&
        t.kind === 'system_info' &&
        t.status === 'done',
    )
  }, [tasksQ.data, agentId])

  const diffM = useMutation({
    mutationFn: () => api.machineDiff(agentId, fromId, toId),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">История изменений узла</CardTitle>
        <CardDescription>
          Сравнение двух завершённых задач <code className="text-xs">system_info</code> по
          плоскому JSON: что поменялось между запусками.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Агент</Label>
            <Select
              value={agentId === '' ? NO_AGENT : agentId}
              onValueChange={(v) => {
                if (v === NO_AGENT) return
                setAgentId(v)
                setFromId('')
                setToId('')
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите агента" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_AGENT} disabled>
                  Выберите агента
                </SelectItem>
                {(agentsQ.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Ранний снимок</Label>
            <Select
              value={fromId === '' ? NO_TASK : fromId}
              onValueChange={(v) => v !== NO_TASK && setFromId(v)}
              disabled={!agentId || systemTasks.length < 2}
            >
              <SelectTrigger>
                <SelectValue placeholder="Задача" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TASK} disabled>
                  Задача
                </SelectItem>
                {systemTasks.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {formatDateTime(t.created_at)} · {t.id.slice(0, 8)}…
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Поздний снимок</Label>
            <Select
              value={toId === '' ? NO_TASK : toId}
              onValueChange={(v) => v !== NO_TASK && setToId(v)}
              disabled={!agentId || systemTasks.length < 2}
            >
              <SelectTrigger>
                <SelectValue placeholder="Задача" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TASK} disabled>
                  Задача
                </SelectItem>
                {systemTasks.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {formatDateTime(t.created_at)} · {t.id.slice(0, 8)}…
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          type="button"
          disabled={!agentId || !fromId || !toId || fromId === toId || diffM.isPending}
          onClick={() => diffM.mutate()}
        >
          {diffM.isPending ? 'Считаем…' : 'Сравнить'}
        </Button>

        {diffM.isError && (
          <p className="text-sm text-destructive">
            {diffM.error instanceof Error ? diffM.error.message : 'Ошибка'}
          </p>
        )}

        {diffM.data && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Изменений: <strong>{diffM.data.changed_count}</strong>
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Поле</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Было</TableHead>
                  <TableHead>Стало</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diffM.data.changes.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-[200px] font-mono text-xs">
                      {c.path}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{c.change}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate font-mono text-xs">
                      {String(c.before)}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate font-mono text-xs">
                      {String(c.after)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
