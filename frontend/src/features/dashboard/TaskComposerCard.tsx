import { useRef, type ChangeEvent, type FormEvent } from 'react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  KIND_DESCRIPTIONS,
  KIND_LABELS,
  TASK_KINDS,
  type TaskKind,
} from '@/features/taskComposer/presets'

/** Стабильное значение Radix Select при отсутствии агентов (всегда controlled). */
const NO_AGENTS_VALUE = '__infrahub_no_agents__'
import { useTaskComposerStore } from '@/stores/taskComposerStore'
import type { Agent } from '@/api'
import { Download, FileJson, Upload } from 'lucide-react'

type Props = {
  agents: Agent[]
  agentId: string
  onSubmitTask: () => void
  submitting: boolean
  submitError: string | null
  /** Режим наблюдателя: только просмотр */
  readOnly?: boolean
}

export function TaskComposerCard({
  agents,
  agentId,
  onSubmitTask,
  submitting,
  submitError,
  readOnly = false,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const {
    kind,
    payloadText,
    maxRetries,
    setSelectedAgentId,
    applyKindPreset,
    setPayloadText,
    setMaxRetries,
  } = useTaskComposerStore()

  function onKindChange(value: string) {
    applyKindPreset(value as TaskKind)
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      try {
        JSON.parse(text)
        setPayloadText(text)
        toast.success('Payload загружен из файла')
      } catch {
        toast.error('Файл не является валидным JSON')
      }
    }
    reader.readAsText(f)
    e.target.value = ''
  }

  function downloadPayload() {
    const blob = new Blob([payloadText], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'infrahub-payload.json'
    a.click()
    URL.revokeObjectURL(url)
    toast.message('JSON скачан')
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmitTask()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Новая задача</CardTitle>
        <CardDescription>
          Одна проверка = тип + JSON payload. При смене типа подставляется шаблон
          ниже (можно править). Состояние сохраняется в браузере.
        </CardDescription>
        {readOnly && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Роль «наблюдатель»: постановка задач отключена.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={onFormSubmit} className="space-y-4">
          <fieldset
            disabled={readOnly}
            className="min-w-0 space-y-4 border-0 p-0 disabled:opacity-60"
          >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agent">Агент</Label>
              <Select
                value={
                  agents.length === 0
                    ? NO_AGENTS_VALUE
                    : agents.some((a) => a.id === agentId)
                      ? agentId
                      : agents[0]!.id
                }
                onValueChange={(v) => {
                  if (v !== NO_AGENTS_VALUE) setSelectedAgentId(v)
                }}
                disabled={agents.length === 0}
              >
                <SelectTrigger id="agent">
                  <SelectValue placeholder="Нет агентов" />
                </SelectTrigger>
                <SelectContent>
                  {agents.length === 0 ? (
                    <SelectItem value={NO_AGENTS_VALUE} disabled>
                      Нет агентов
                    </SelectItem>
                  ) : (
                    agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="retries">
                Повторы при ошибке (max_retries, 0 = без повторов)
              </Label>
              <Input
                id="retries"
                type="number"
                min={0}
                max={10}
                value={maxRetries}
                onChange={(e) =>
                  setMaxRetries(Number.parseInt(e.target.value, 10) || 0)
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="kind">Проверка</Label>
            <Select value={kind} onValueChange={onKindChange}>
              <SelectTrigger id="kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {KIND_DESCRIPTIONS[kind]}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="payload">Параметры (JSON)</Label>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={onFileChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="size-4" />
                  Загрузить файл
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadPayload}
                >
                  <Download className="size-4" />
                  Скачать JSON
                </Button>
              </div>
            </div>
            <Textarea
              id="payload"
              rows={10}
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              className="font-mono text-xs md:text-sm"
              spellCheck={false}
            />
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <FileJson className="size-3.5 shrink-0" />
              Для пакетных шагов из whitelist используйте блок «Шаблоны проверок»
              выше или тип «Набор проверок» с полем template.
            </p>
          </div>

          {submitError && (
            <p className="text-sm text-destructive">{submitError}</p>
          )}

          <Button type="submit" disabled={readOnly || !agentId || submitting}>
            {submitting ? 'Отправка…' : 'Поставить в очередь'}
          </Button>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  )
}
