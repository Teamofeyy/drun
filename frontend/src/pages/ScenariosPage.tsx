import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CopyPlus, Download, LibraryBig, Play, Plus, Save, Search, Upload } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api, canOperate, type Scenario } from '@/api'
import { ScenarioStepEditor } from '@/features/scenarios/ScenarioStepEditor'
import {
  parseScenarioDefinitionText,
  stringifyScenarioDefinition,
  type ScenarioDefinition,
} from '@/features/scenarios/dsl'
import { qk } from '@/queryKeys'
import { formatDateTime } from '@/utils/format'
import { cn } from '@/lib/utils'

type Draft = {
  id: string | null
  name: string
  slug: string
  description: string
  tagsText: string
  status: string
  summaryTemplate: string
  definitionText: string
  inputSchemaText: string
  isPreset: boolean
}

function parseJsonValue(text: string, field: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON'
    throw new Error(`${field}: ${message}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function scenarioToDraft(item: Scenario): Draft {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    description: item.description,
    tagsText: item.tags.join(', '),
    status: item.status,
    summaryTemplate: item.summary_template ?? '',
    definitionText: JSON.stringify(item.definition, null, 2),
    inputSchemaText: JSON.stringify(item.input_schema, null, 2),
    isPreset: item.is_preset,
  }
}

function emptyDraft(): Draft {
  return {
    id: null,
    name: 'Новый сценарий',
    slug: '',
    description: '',
    tagsText: '',
    status: 'draft',
    summaryTemplate: '',
    definitionText: JSON.stringify(
      {
        inputs: {},
        steps: [{ id: 'step-1', type: 'system_info', title: 'Системная информация' }],
      },
      null,
      2,
    ),
    inputSchemaText: '{}',
    isPreset: false,
  }
}

export function ScenariosPage() {
  const qc = useQueryClient()
  const importRef = useRef<HTMLInputElement | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [runAgentId, setRunAgentId] = useState<string>('')
  const [runInputsText, setRunInputsText] = useState('{}')
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState<'all' | 'system' | 'custom'>('all')

  const scenariosQ = useQuery({
    queryKey: qk.scenarios,
    queryFn: api.scenarios,
    refetchInterval: 300_000,
  })
  const agentsQ = useQuery({
    queryKey: qk.agents,
    queryFn: api.agents,
    refetchInterval: 300_000,
  })

  const scenarios = scenariosQ.data ?? []
  const agents = agentsQ.data ?? []
  const filteredScenarios = useMemo(() => {
    const query = search.trim().toLowerCase()
    return scenarios.filter((item) => {
      if (scope === 'system' && !item.is_preset) return false
      if (scope === 'custom' && item.is_preset) return false
      if (!query) return true
      const haystack = [
        item.name,
        item.slug,
        item.description,
        item.status,
        ...item.tags,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [scenarios, scope, search])

  useEffect(() => {
    if (scenarios.length === 0) {
      setSelectedId(null)
      setDraft(emptyDraft())
      return
    }
    if (!selectedId || !scenarios.some((s) => s.id === selectedId)) {
      const first = scenarios[0]
      setSelectedId(first.id)
      setDraft(scenarioToDraft(first))
    }
  }, [scenarios, selectedId])

  useEffect(() => {
    if (agents.length === 0) return
    if (!runAgentId || !agents.some((agent) => agent.id === runAgentId)) {
      setRunAgentId(agents[0].id)
    }
  }, [agents, runAgentId])

  const selectedScenario = useMemo(
    () => scenarios.find((item) => item.id === selectedId) ?? null,
    [scenarios, selectedId],
  )

  const definitionState = useMemo<{
    parsed: ScenarioDefinition | null
    error: string | null
  }>(() => {
    try {
      return {
        parsed: parseScenarioDefinitionText(draft.definitionText),
        error: null,
      }
    } catch (error) {
      return {
        parsed: null,
        error:
          error instanceof Error ? error.message : 'Definition JSON is invalid',
      }
    }
  }, [draft.definitionText])

  const inputSchemaError = useMemo(() => {
    try {
      parseJsonValue(draft.inputSchemaText, 'Input schema')
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Input schema JSON is invalid'
    }
  }, [draft.inputSchemaText])

  const createScenario = useMutation({
    mutationFn: async () => {
      const definition = parseJsonValue(draft.definitionText, 'Definition')
      const inputSchema = parseJsonValue(draft.inputSchemaText, 'Input schema')
      return api.createScenario({
        name: draft.name,
        slug: draft.slug || undefined,
        description: draft.description,
        tags: draft.tagsText
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        status: draft.status,
        summary_template: draft.summaryTemplate || null,
        definition,
        input_schema: inputSchema,
      })
    },
    onSuccess: (item) => {
      toast.success('Сценарий создан')
      qc.invalidateQueries({ queryKey: qk.scenarios })
      setSelectedId(item.id)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Не удалось создать сценарий')
    },
  })

  const updateScenario = useMutation({
    mutationFn: async () => {
      if (!draft.id) throw new Error('Нет выбранного сценария')
      const definition = parseJsonValue(draft.definitionText, 'Definition')
      const inputSchema = parseJsonValue(draft.inputSchemaText, 'Input schema')
      return api.updateScenario(draft.id, {
        name: draft.name,
        slug: draft.slug,
        description: draft.description,
        tags: draft.tagsText
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        status: draft.status,
        summary_template: draft.summaryTemplate || null,
        definition,
        input_schema: inputSchema,
      })
    },
    onSuccess: (item) => {
      toast.success('Сценарий сохранён')
      qc.invalidateQueries({ queryKey: qk.scenarios })
      setSelectedId(item.id)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить сценарий')
    },
  })

  const cloneScenario = useMutation({
    mutationFn: async () => {
      if (!selectedScenario) throw new Error('Нет выбранного сценария')
      return api.createScenario({
        name: `${selectedScenario.name} Copy`,
        slug: `${selectedScenario.slug}-copy`,
        description: selectedScenario.description,
        tags: selectedScenario.tags,
        status: 'draft',
        summary_template: selectedScenario.summary_template,
        definition: selectedScenario.definition,
        input_schema: selectedScenario.input_schema,
      })
    },
    onSuccess: (item) => {
      toast.success('Сценарий клонирован')
      qc.invalidateQueries({ queryKey: qk.scenarios })
      setSelectedId(item.id)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Не удалось клонировать сценарий')
    },
  })

  const runScenario = useMutation({
    mutationFn: async () => {
      if (!selectedScenario) throw new Error('Нет выбранного сценария')
      const inputs = JSON.parse(runInputsText || '{}')
      return api.runScenario(selectedScenario.id, {
        agent_id: runAgentId,
        inputs,
      })
    },
    onSuccess: (task) => {
      toast.success('Сценарий поставлен в очередь')
      qc.invalidateQueries({ queryKey: qk.tasks })
      window.location.href = `/app/tasks/${task.id}`
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Не удалось запустить сценарий',
      )
    },
  })

  const operate = canOperate()
  const parsedDefinition = definitionState.parsed
  const definitionError = definitionState.error

  function exportScenario(item: Scenario) {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            name: item.name,
            slug: item.slug,
            description: item.description,
            tags: item.tags,
            status: item.status,
            summary_template: item.summary_template,
            definition: item.definition,
            input_schema: item.input_schema,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${item.slug || 'scenario'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importScenario(file: File) {
    const text = await file.text()
    const payload = parseJsonValue(text, 'Scenario import')
    if (!isRecord(payload)) {
      throw new Error('Scenario import: root JSON must be an object')
    }
    const name =
      typeof payload.name === 'string' && payload.name.trim()
        ? payload.name
        : 'Imported scenario'
    const slug =
      typeof payload.slug === 'string' && payload.slug.trim() ? payload.slug : ''
    const description = typeof payload.description === 'string' ? payload.description : ''
    const status = typeof payload.status === 'string' && payload.status.trim() ? payload.status : 'draft'
    const summaryTemplate =
      typeof payload.summary_template === 'string' ? payload.summary_template : ''
    const tags = Array.isArray(payload.tags)
      ? payload.tags.filter((item): item is string => typeof item === 'string')
      : []
    const definition = 'definition' in payload ? payload.definition : payload
    const inputSchema = 'input_schema' in payload ? payload.input_schema : {}

    setSelectedId(null)
    setDraft({
      id: null,
      name,
      slug,
      description,
      tagsText: tags.join(', '),
      status,
      summaryTemplate,
      definitionText: JSON.stringify(definition, null, 2),
      inputSchemaText: JSON.stringify(inputSchema, null, 2),
      isPreset: false,
    })
    toast.success('Сценарий импортирован в черновик')
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="sticky top-2 max-h-[calc(100vh-120px)] overflow-y-auto border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <LibraryBig className="size-4" />
            Scenario Library
          </CardTitle>
          <CardDescription className="text-sm leading-snug">
            Системные и пользовательские сценарии диагностики. Логика хранится как JSON DSL.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.currentTarget.value = ''
              if (!file) return
              try {
                await importScenario(file)
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Не удалось импортировать сценарий')
              }
            }}
          />

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                placeholder="Поиск по имени, slug, тегам"
              />
            </div>
            <Select value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
              <SelectTrigger className="sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            className="w-full justify-between"
            disabled={!operate}
            onClick={() => {
              setSelectedId(null)
              setDraft(emptyDraft())
            }}
          >
            Новый сценарий
            <Plus className="size-4" />
          </Button>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              disabled={!operate}
              onClick={() => importRef.current?.click()}
            >
              <Upload className="size-4" />
              Import
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!selectedScenario}
              onClick={() => {
                if (selectedScenario) exportScenario(selectedScenario)
              }}
            >
              <Download className="size-4" />
              Export
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{scenarios.length} total</Badge>
            <Badge variant="outline">{scenarios.filter((item) => item.is_preset).length} system</Badge>
            <Badge variant="outline">{scenarios.filter((item) => !item.is_preset).length} custom</Badge>
          </div>

          <div className="space-y-2">
            {scenariosQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка…</p>
            ) : filteredScenarios.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ничего не найдено. Попробуйте изменить фильтр или создать новый сценарий.
              </p>
            ) : (
              filteredScenarios.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    'w-full rounded-xl border border-border/70 bg-card/80 px-4 py-3 text-left transition-colors hover:bg-muted/50',
                    selectedId === item.id && 'border-primary bg-primary/8 shadow-sm',
                  )}
                  onClick={() => {
                    setSelectedId(item.id)
                    setDraft(scenarioToDraft(item))
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.slug}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {item.is_preset && <Badge variant="secondary">preset</Badge>}
                      <Badge variant="outline">v{item.version}</Badge>
                    </div>
                  </div>
                  {item.tags.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">{item.tags.join(' · ')}</p>
                  )}
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
        {selectedScenario && (
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="text-lg">Run Scenario</CardTitle>
              <CardDescription>
                Запуск сценария на выбранном агенте с JSON inputs.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-2">
                <Label>Agent</Label>
                <Select value={runAgentId || undefined} onValueChange={setRunAgentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите агента" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="run-inputs">Inputs JSON</Label>
                <Textarea
                  id="run-inputs"
                  rows={3}
                  className="font-mono text-xs"
                  value={runInputsText}
                  onChange={(e) => setRunInputsText(e.target.value)}
                  placeholder='{"targets":["1.1.1.1:443"]}'
                />
              </div>

              <Button
                type="button"
                className="md:mb-0.5"
                disabled={!operate || !runAgentId || runScenario.isPending}
                onClick={() => runScenario.mutate()}
              >
                <Play className="size-4" />
                Запустить
              </Button>
            </CardContent>
          </Card>
        )}

        <ScenarioStepEditor
          definition={parsedDefinition}
          parseError={definitionError}
          readOnly={!operate || draft.isPreset}
          onChange={(definition) =>
            setDraft((prev) => ({
              ...prev,
              definitionText: stringifyScenarioDefinition(definition),
            }))
          }
        />

        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">Scenario Editor</CardTitle>
                <CardDescription>
                  Метаданные сценария, input schema и raw JSON для точной настройки.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedScenario?.is_preset && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!operate || cloneScenario.isPending}
                    onClick={() => cloneScenario.mutate()}
                  >
                    <CopyPlus className="size-4" />
                    Клонировать preset
                  </Button>
                )}
                <Button
                  type="button"
                  disabled={
                    !operate ||
                    createScenario.isPending ||
                    Boolean(definitionError) ||
                    Boolean(inputSchemaError)
                  }
                  variant="outline"
                  onClick={() => createScenario.mutate()}
                >
                  <Plus className="size-4" />
                  Create
                </Button>
                <Button
                  type="button"
                  disabled={
                    !operate ||
                    !draft.id ||
                    draft.isPreset ||
                    updateScenario.isPending ||
                    Boolean(definitionError) ||
                    Boolean(inputSchemaError)
                  }
                  onClick={() => updateScenario.mutate()}
                >
                  <Save className="size-4" />
                  Save
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="scenario-name">Название</Label>
                <Input
                  id="scenario-name"
                  value={draft.name}
                  disabled={!operate || draft.isPreset}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="scenario-slug">Slug</Label>
                <Input
                  id="scenario-slug"
                  value={draft.slug}
                  disabled={!operate || draft.isPreset}
                  onChange={(e) => setDraft((prev) => ({ ...prev, slug: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="scenario-tags">Теги</Label>
                <Input
                  id="scenario-tags"
                  value={draft.tagsText}
                  disabled={!operate || draft.isPreset}
                  onChange={(e) => setDraft((prev) => ({ ...prev, tagsText: e.target.value }))}
                  placeholder="network, baseline, prod"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="scenario-status">Статус</Label>
                <Input
                  id="scenario-status"
                  value={draft.status}
                  disabled={!operate || draft.isPreset}
                  onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value }))}
                  placeholder="draft | published | archived"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="scenario-description">Описание</Label>
                <Textarea
                  id="scenario-description"
                  rows={4}
                  value={draft.description}
                  disabled={!operate || draft.isPreset}
                  onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="summary-template">Summary template</Label>
                <Textarea
                  id="summary-template"
                  rows={3}
                  value={draft.summaryTemplate}
                  disabled={!operate || draft.isPreset}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, summaryTemplate: e.target.value }))
                  }
                  placeholder="Краткая сводка для run result"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="definition-json">Definition JSON</Label>
                <Textarea
                  id="definition-json"
                  rows={8}
                  className="font-mono text-xs"
                  value={draft.definitionText}
                  disabled={!operate || draft.isPreset}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, definitionText: e.target.value }))
                  }
                />
                {definitionError && (
                  <p className="text-xs text-destructive">{definitionError}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="input-schema-json">Input Schema JSON</Label>
                <Textarea
                  id="input-schema-json"
                  rows={6}
                  className="font-mono text-xs"
                  value={draft.inputSchemaText}
                  disabled={!operate || draft.isPreset}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, inputSchemaText: e.target.value }))
                  }
                />
                {inputSchemaError && (
                  <p className="text-xs text-destructive">{inputSchemaError}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {selectedScenario && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Scenario Meta</CardTitle>
              <CardDescription>
                Версия {selectedScenario.version} · создан {formatDateTime(selectedScenario.created_at)}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Тип</p>
                <p className="mt-2 font-medium">{selectedScenario.is_preset ? 'System preset' : 'Custom scenario'}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Статус</p>
                <p className="mt-2 font-medium">{selectedScenario.status}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Slug</p>
                <p className="mt-2 font-mono text-sm">{selectedScenario.slug}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Обновлён</p>
                <p className="mt-2 font-medium">{formatDateTime(selectedScenario.updated_at)}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
