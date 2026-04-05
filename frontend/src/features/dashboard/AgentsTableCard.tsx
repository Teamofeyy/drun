import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Agent } from '@/api'
import { api } from '@/api'
import { qk } from '@/queryKeys'
import { formatDateTime, formatRelative } from '@/utils/format'
import { cn } from '@/lib/utils'

function statusVariant(
  s: string,
): 'success' | 'warning' | 'muted' | 'secondary' {
  if (s === 'online') return 'success'
  if (s === 'offline') return 'muted'
  return 'secondary'
}

function dash(s: string) {
  const t = s?.trim()
  return t ? t : '—'
}

export function AgentsTableCard({
  agents,
  loading,
  canEditMeta,
  selectedIds = [],
  onToggleAgent,
  onToggleAll,
}: {
  agents: Agent[]
  loading: boolean
  canEditMeta: boolean
  selectedIds?: string[]
  onToggleAgent?: (agentId: string, checked: boolean) => void
  onToggleAll?: (checked: boolean) => void
}) {
  const qc = useQueryClient()
  const [edit, setEdit] = useState<Agent | null>(null)
  const [site, setSite] = useState('')
  const [segment, setSegment] = useState('')
  const [roleTag, setRoleTag] = useState('')

  const patch = useMutation({
    mutationFn: () =>
      api.patchAgent(edit!.id, { site, segment, role_tag: roleTag }),
    onSuccess: () => {
      toast.success('Метаданные агента сохранены')
      qc.invalidateQueries({ queryKey: qk.agents })
      setEdit(null)
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : 'Ошибка сохранения'),
  })

  function openEdit(a: Agent) {
    setEdit(a)
    setSite(a.site ?? '')
    setSegment(a.segment ?? '')
    setRoleTag(a.role_tag ?? '')
  }

  const selectable = Boolean(onToggleAgent)
  const allSelected = agents.length > 0 && agents.every((agent) => selectedIds.includes(agent.id))

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Агенты</CardTitle>
          <CardDescription>
            Реестр агентов, статусы и метаданные. Отсюда удобно выбирать узлы для массовых операций.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Пока нет агентов. Запустите агент на машине.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {selectable && (
                    <TableHead className="w-[44px]">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(event) => onToggleAll?.(event.target.checked)}
                        aria-label="Выбрать всех агентов"
                      />
                    </TableHead>
                  )}
                  <TableHead>Имя</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="hidden lg:table-cell">Площадка</TableHead>
                  <TableHead className="hidden lg:table-cell">Сегмент</TableHead>
                  <TableHead className="hidden md:table-cell">Роль узла</TableHead>
                  <TableHead className="hidden lg:table-cell">Арх.</TableHead>
                  <TableHead>Активность</TableHead>
                  <TableHead className="hidden xl:table-cell">ID</TableHead>
                  {canEditMeta && <TableHead className="w-[100px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((a) => (
                  <TableRow key={a.id}>
                    {selectable && (
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(a.id)}
                          onChange={(event) => onToggleAgent?.(a.id, event.target.checked)}
                          aria-label={`Выбрать агента ${a.name}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(a.status)}>{a.status}</Badge>
                    </TableCell>
                    <TableCell className="hidden max-w-[120px] truncate text-muted-foreground lg:table-cell">
                      {dash(a.site)}
                    </TableCell>
                    <TableCell className="hidden max-w-[120px] truncate text-muted-foreground lg:table-cell">
                      {dash(a.segment)}
                    </TableCell>
                    <TableCell className="hidden max-w-[100px] truncate text-muted-foreground md:table-cell">
                      {dash(a.role_tag)}
                    </TableCell>
                    <TableCell className="hidden max-w-[90px] truncate font-mono text-xs text-muted-foreground lg:table-cell">
                      {dash(a.cpu_arch ?? '')}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.last_seen_at ? (
                        <span title={formatDateTime(a.last_seen_at)}>
                          {formatRelative(a.last_seen_at)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'hidden max-w-[160px] truncate font-mono text-xs xl:table-cell',
                      )}
                      title={a.id}
                    >
                      {a.id}
                    </TableCell>
                    {canEditMeta && (
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(a)}
                        >
                          Группы
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Группы и метки</DialogTitle>
            <DialogDescription>
              Агент: <strong>{edit?.name}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="site">Площадка (site)</Label>
              <Input
                id="site"
                value={site}
                onChange={(e) => setSite(e.target.value)}
                placeholder="например eu-west-1 / dc-a"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="segment">Сегмент</Label>
              <Input
                id="segment"
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                placeholder="prod / pentest / office"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role_tag">Роль узла</Label>
              <Input
                id="role_tag"
                value={roleTag}
                onChange={(e) => setRoleTag(e.target.value)}
                placeholder="worker, edge, bastion…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEdit(null)}>
              Отмена
            </Button>
            <Button
              type="button"
              disabled={patch.isPending}
              onClick={() => patch.mutate()}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
