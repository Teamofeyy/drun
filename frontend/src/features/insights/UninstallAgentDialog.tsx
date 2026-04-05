import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { toast } from 'sonner'
import {
  api,
  uninstallAgent,
  type ProvisionAgentResponse,
  type UninstallAgentRequest,
} from '@/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { qk } from '@/queryKeys'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UninstallAgentDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient()
  const baseId = useId()
  const [host, setHost] = useState('')
  const [sshUser, setSshUser] = useState('')
  const [sshPort, setSshPort] = useState('22')
  const [authKind, setAuthKind] = useState<'key' | 'password'>('key')
  const [privateKey, setPrivateKey] = useState('')
  const [sshPassword, setSshPassword] = useState('')
  const [removeAgentId, setRemoveAgentId] = useState('')
  const [lastResult, setLastResult] = useState<ProvisionAgentResponse | null>(
    null,
  )

  const agentsQ = useQuery({
    queryKey: qk.agents,
    queryFn: api.agents,
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    setLastResult(null)
    setRemoveAgentId('')
  }, [open])

  const run = useMutation({
    mutationFn: () => {
      const port = Number.parseInt(sshPort, 10)
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        return Promise.reject(new Error('Некорректный SSH-порт'))
      }
      if (!host.trim() || !sshUser.trim()) {
        return Promise.reject(new Error('Заполните хост и SSH-пользователя'))
      }
      const body: UninstallAgentRequest = {
        host: host.trim(),
        ssh_user: sshUser.trim(),
        ssh_port: port,
        remove_agent_id: removeAgentId.trim() || null,
      }
      if (authKind === 'key') {
        body.private_key_pem = privateKey.trim() || null
        body.ssh_password = null
      } else {
        body.ssh_password = sshPassword || null
        body.private_key_pem = null
      }
      return uninstallAgent(body)
    },
    onSuccess: (data) => {
      setLastResult(data)
      void qc.invalidateQueries({ queryKey: qk.topology })
      void qc.invalidateQueries({ queryKey: qk.agents })
      if (data.ok) {
        toast.success(data.message)
        onOpenChange(false)
        setPrivateKey('')
        setSshPassword('')
      } else {
        toast.error(data.message)
      }
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Ошибка запроса'
      toast.error(msg)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Снять агента с ноды</DialogTitle>
          <DialogDescription>
            Останавливается unit <code className="text-xs">infrahub-agent</code>,
            удаляются unit-файл, <code className="text-xs">/etc/default/infrahub-agent</code>,
            бинарь и каталог состояния на целевом хосте. Ниже можно выбрать агента в InfraHub —
            после успешного снятия с ноды запись удалится, и узел пропадёт с топологии.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${baseId}-host`}>Хост (IP или FQDN)</Label>
              <Input
                id={`${baseId}-host`}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="10.0.0.5"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${baseId}-user`}>SSH пользователь</Label>
              <Input
                id={`${baseId}-user`}
                value={sshUser}
                onChange={(e) => setSshUser(e.target.value)}
                placeholder="ubuntu"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${baseId}-port`}>SSH порт</Label>
            <Input
              id={`${baseId}-port`}
              type="number"
              min={1}
              max={65535}
              value={sshPort}
              onChange={(e) => setSshPort(e.target.value)}
              className="max-w-40"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${baseId}-agent`}>Запись в InfraHub (топология)</Label>
            <select
              id={`${baseId}-agent`}
              value={removeAgentId}
              onChange={(e) => setRemoveAgentId(e.target.value)}
              disabled={agentsQ.isPending}
              className={cn(
                'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <option value="">Не удалять запись (только с ноды)</option>
              {(agentsQ.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {agentsQ.isError ? (
              <p className="text-xs text-destructive">Не удалось загрузить список агентов</p>
            ) : null}
          </div>
          <fieldset className="space-y-3 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">Аутентификация SSH</legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${baseId}-auth`}
                  checked={authKind === 'key'}
                  onChange={() => setAuthKind('key')}
                  className="accent-primary"
                />
                Приватный ключ (PEM)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${baseId}-auth`}
                  checked={authKind === 'password'}
                  onChange={() => setAuthKind('password')}
                  className="accent-primary"
                />
                Пароль SSH
              </label>
            </div>
            {authKind === 'key' ? (
              <div className="space-y-2">
                <Label htmlFor={`${baseId}-key`}>Private key PEM</Label>
                <Textarea
                  id={`${baseId}-key`}
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  rows={6}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor={`${baseId}-pw`}>SSH пароль</Label>
                <Input
                  id={`${baseId}-pw`}
                  type="password"
                  value={sshPassword}
                  onChange={(e) => setSshPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            )}
          </fieldset>
          {lastResult && !lastResult.ok && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">
                Код: {lastResult.exit_code ?? '—'}
              </p>
              {lastResult.stderr ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
                  {lastResult.stderr}
                </pre>
              ) : null}
              {lastResult.stdout ? (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
                  {lastResult.stdout}
                </pre>
              ) : null}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending ? 'Выполняется…' : 'Снять агента'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
