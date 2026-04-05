import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  createStep,
  defaultParamsForType,
  SCENARIO_STEP_TYPES,
  STEP_LABELS,
  stringifyScenarioDefinition,
  type ScenarioDefinition,
  type ScenarioStep,
  type ScenarioStepType,
} from './dsl'

type Props = {
  definition: ScenarioDefinition | null
  readOnly?: boolean
  parseError?: string | null
  onChange: (definition: ScenarioDefinition) => void
  /** Без обёртки Card — для вкладок и вложенных экранов */
  embedded?: boolean
}

function replaceStep(
  steps: ScenarioStep[],
  index: number,
  patch: Partial<ScenarioStep>,
): ScenarioStep[] {
  return steps.map((step, current) =>
    current === index ? { ...step, ...patch } : step,
  )
}

export function ScenarioStepEditor({
  definition,
  readOnly = false,
  parseError,
  onChange,
  embedded = false,
}: Props) {
  const [newType, setNewType] = useState<ScenarioStepType>('system_info')

  const steps = definition?.steps ?? []
  const summary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const step of steps) {
      counts.set(step.type, (counts.get(step.type) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([type, count]) => `${STEP_LABELS[type as ScenarioStepType]}: ${count}`)
      .join(' · ')
  }, [steps])

  if (!definition) {
    const errBody = (
      <p className="text-sm text-amber-800 dark:text-amber-200">
        {parseError ?? 'Сначала исправьте JSON определения на вкладке «JSON».'}
      </p>
    )
    if (embedded) {
      return (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3">
          {errBody}
        </div>
      )
    }
    return (
      <Card className="border-amber-300/60">
        <CardHeader>
          <CardTitle className="text-lg">Редактор шагов</CardTitle>
          <CardDescription>
            Визуальный редактор доступен после валидного JSON definition.
          </CardDescription>
        </CardHeader>
        <CardContent>{errBody}</CardContent>
      </Card>
    )
  }

  const activeDefinition = definition

  function updateSteps(nextSteps: ScenarioStep[]) {
    onChange({
      inputs: activeDefinition.inputs,
      steps: nextSteps,
    })
  }

  function updateStepParams(index: number, text: string) {
    const params = JSON.parse(text) as Record<string, unknown>
    updateSteps(replaceStep(steps, index, { params }))
  }

  function moveStep(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= steps.length) return
    const next = [...steps]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    updateSteps(next)
  }

  const body = (
    <div className="space-y-4">
        <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <strong className="text-foreground">Шагов:</strong> {steps.length}
          {summary ? <span> · {summary}</span> : null}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/80 bg-muted/10 p-4 md:flex-row md:items-end">
          <div className="min-w-0 flex-1 space-y-2">
            <Label>Добавить шаг</Label>
            <Select
              value={newType}
              onValueChange={(value) => setNewType(value as ScenarioStepType)}
              disabled={readOnly}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCENARIO_STEP_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {STEP_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            disabled={readOnly}
            onClick={() => updateSteps([...steps, createStep(newType, steps.length)])}
          >
            <Plus className="size-4" />
            Добавить
          </Button>
        </div>

        <div className="space-y-3">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    Шаг {index + 1} · {STEP_LABELS[step.type]}
                  </p>
                  <p className="text-xs text-muted-foreground">{step.id}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={readOnly || index === 0}
                    onClick={() => moveStep(index, -1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={readOnly || index === steps.length - 1}
                    onClick={() => moveStep(index, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={readOnly || steps.length === 1}
                    onClick={() => updateSteps(steps.filter((_, current) => current !== index))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Step ID</Label>
                  <Input
                    value={step.id}
                    disabled={readOnly}
                    onChange={(e) =>
                      updateSteps(replaceStep(steps, index, { id: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Тип шага</Label>
                  <Select
                    value={step.type}
                    disabled={readOnly}
                    onValueChange={(value) => {
                      const nextType = value as ScenarioStepType
                      updateSteps(
                        replaceStep(steps, index, {
                          type: nextType,
                          title: STEP_LABELS[nextType],
                          params: defaultParamsForType(nextType),
                        }),
                      )
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCENARIO_STEP_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {STEP_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Заголовок шага</Label>
                  <Input
                    value={step.title}
                    disabled={readOnly}
                    onChange={(e) =>
                      updateSteps(replaceStep(steps, index, { title: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Params JSON</Label>
                  <Textarea
                    rows={8}
                    className="font-mono text-xs"
                    value={JSON.stringify(step.params, null, 2)}
                    disabled={readOnly}
                    onChange={(e) => {
                      try {
                        updateStepParams(index, e.target.value)
                      } catch {
                        // Keep textarea editable until JSON becomes valid again.
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <details className="rounded-xl border border-border/70 bg-muted/10 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Предпросмотр definition JSON
          </summary>
          <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-muted/30 p-4 font-mono text-xs">
            {stringifyScenarioDefinition(definition)}
          </pre>
        </details>
    </div>
  )

  if (embedded) {
    return body
  }

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="text-lg">Редактор шагов</CardTitle>
        <CardDescription>
          Сборка сценария из шагов; JSON синхронизируется автоматически.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{body}</CardContent>
    </Card>
  )
}
