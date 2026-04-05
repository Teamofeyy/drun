import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { toast } from 'sonner'
import {
  fetchProvisionAgentDefaults,
  provisionAgent,
  type ProvisionAgentRequest,
  type ProvisionAgentResponse,
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
import { defaultInfrahubApiBase } from '@/lib/defaultInfrahubApiBase'
import { qk } from '@/queryKeys'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProvisionAgentDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient()
  const baseId = useId()
  const [host, setHost] = useState('')
  const [sshUser, setSshUser] = useState('')
  const [sshPort, setSshPort] = useState('22')
  const [apiBase, setApiBase] = useState('')
  const [authKind, setAuthKind] = useState<'key' | 'password'>('key')
  const [privateKey, setPrivateKey] = useState('')
  const [sshPassword, setSshPassword] = useState('')
  const [lastResult, setLastResult] = useState<ProvisionAgentResponse | null>(
    null,
  )

  useEffect(() => {
    if (open && typeof window !== 'undefined' && !apiBase) {
      const { hostname, origin } = window.location
      // На проде API с того же origin (nginx проксирует /api); localhost пользователь заполняет вручную.
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        setApiBase(origin)
      }
    }
  }, [open])

  const releaseDefaults = useQuery({
    queryKey: qk.provisionAgentDefaults,
    queryFn: fetchProvisionAgentDefaults,
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    setLastResult(null)
  }, [open])

  const provision = useMutation({
    mutationFn: () => {
      const port = Number.parseInt(sshPort, 10)
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        return Promise.reject(new Error('Некорректный SSH-порт'))
      }
      if (!host.trim() || !sshUser.trim() || !apiBase.trim()) {
        return Promise.reject(
          new Error('Заполните хост, SSH-пользователя и URL API'),
        )
      }
      const targetHost = host.trim().toLowerCase()
      const targetIsRemote =
        targetHost !== 'localhost' &&
        targetHost !== '127.0.0.1' &&
        targetHost !== '::1'
      const api = apiBase.trim()
      if (
        targetIsRemote &&
        (/localhost/i.test(api) ||
          /127\.0\.0\.1/.test(api) ||
          /\[::1\]/.test(api))
      ) {
        return Promise.reject(
          new Error(
            'URL API указывает на localhost, а SSH-хост — удалённый сервер: с него до InfraHub так не подключиться. Укажите публичный IP или DNS InfraHub, доступный с целевой машины.',
          ),
        )
      }
      const body: ProvisionAgentRequest = {
        host: host.trim(),
        ssh_user: sshUser.trim(),
        ssh_port: port,
        infrahub_api_base: apiBase.trim(),
      }
      if (authKind === 'key') {
        body.private_key_pem = privateKey.trim() || null
        body.ssh_password = null
      } else {
        body.ssh_password = sshPassword || null
        body.private_key_pem = null
      }
      return provisionAgent(body)
    },
    onSuccess: (data) => {
      setLastResult(data)
      void qc.invalidateQueries({ queryKey: qk.topology })
      void qc.invalidateQueries({ queryKey: qk.agents })
      if (data.ok) {
        toast.success(data.message)
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
          <DialogTitle>Установить агента по SSH</DialogTitle>
          <DialogDescription>
            Данные и ключ отправляются один раз на сервер InfraHub и не
            сохраняются. Бинарь агента скачивается на ноду с GitHub Releases
            (stable musl по <code className="text-xs">ansible_architecture</code>
            : x86_64 / aarch64). Нужны <code className="text-xs">ansible-core</code>{' '}
            и исходящий доступ с ноды к GitHub. Имя агента —{' '}
            <code className="text-xs">ansible_hostname</code> с ноды.
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
            <Label htmlFor={`${baseId}-api`}>URL API для агента</Label>
            <Input
              id={`${baseId}-api`}
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="https://infrahub.example.com"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2 rounded-md border border-border bg-muted/30 px-3 py-2">
            <p className="text-sm font-medium">Каталог URL релиза агента (GitHub)</p>
            {releaseDefaults.isPending ? (
              <p className="text-xs text-muted-foreground">Загрузка…</p>
            ) : releaseDefaults.isError ? (
              <p className="text-xs text-destructive">
                Не удалось получить настройки с сервера
              </p>
            ) : (
              <code className="break-all text-xs">
                {releaseDefaults.data?.infrahub_agent_release_base}
              </code>
            )}
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
                <Label htmlFor={`${baseId}-key`}>Приватный ключ (PEM)</Label>
                <Textarea
                  id={`${baseId}-key`}
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  rows={6}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Обычно <code className="rounded bg-muted px-1">cat ~/.ssh/id_ed25519</code> (без{' '}
                  <code className="rounded bg-muted px-1">.pub</code>); на ноде — ваш{' '}
                  <code className="rounded bg-muted px-1">.pub</code> в{' '}
                  <code className="rounded bg-muted px-1">authorized_keys</code>.
                </p>
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
          {(provision.isPending || lastResult) && (
            <div
              className={cn(
                'space-y-3 rounded-md border p-3 text-sm',
                provision.isPending && 'border-border bg-muted/20',
                lastResult &&
                  (lastResult.ok
                    ? 'border-green-600/35 bg-green-500/5 dark:border-green-500/30'
                    : 'border-destructive/40 bg-destructive/5'),
              )}
              aria-live="polite"
            >
              <p className="text-xs font-medium text-muted-foreground">
                Состояние развёртывания (ansible-playbook)
              </p>
              {provision.isPending ? (
                <p className="text-sm text-muted-foreground">
                  Выполняется playbook на сервере InfraHub. Потоковой передачи нет — полный вывод
                  stdout/stderr появится здесь после завершения.
                </p>
              ) : null}
              {lastResult ? (
                <>
                  <p
                    className={cn(
                      'font-medium',
                      lastResult.ok
                        ? 'text-green-800 dark:text-green-400'
                        : 'text-destructive',
                    )}
                  >
                    {lastResult.ok ? 'Готово' : 'Ошибка'} · код выхода:{' '}
                    {lastResult.exit_code ?? '—'} · {lastResult.message}
                  </p>
                  {lastResult.stderr ? (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">stderr</p>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-background/80 p-2 font-mono text-xs">
                        {lastResult.stderr}
                      </pre>
                    </div>
                  ) : null}
                  {lastResult.stdout ? (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        stdout (вывод ansible)
                      </p>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-background/80 p-2 font-mono text-xs">
                        {lastResult.stdout}
                      </pre>
                    </div>
                  ) : null}
                  {!lastResult.stderr && !lastResult.stdout ? (
                    <p className="text-xs text-muted-foreground">Вывод пустой.</p>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </div>
        <DialogFooter>
          {lastResult?.ok ? (
            <Button
              type="button"
              onClick={() => {
                setPrivateKey('')
                setSshPassword('')
                onOpenChange(false)
              }}
            >
              Закрыть
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button
                type="button"
                disabled={provision.isPending}
                onClick={() => provision.mutate()}
              >
                {provision.isPending ? 'Выполняется ansible-playbook…' : 'Запустить playbook'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
