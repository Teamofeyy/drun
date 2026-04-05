import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CopyPlus,
  Download,
  LibraryBig,
  PanelLeftOpen,
  Play,
  Plus,
  Save,
  Search,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, canOperate, type Agent, type Scenario } from '@/api'
import { ScenarioStepEditor } from '@/features/scenarios/ScenarioStepEditor'
import {
  parseScenarioDefinitionText,
  stringifyScenarioDefinition,
  type ScenarioDefinition,
} from '@/features/scenarios/dsl'
import { qk } from '@/queryKeys'
import { formatDateTime } from '@/utils/format'
import { cn } from '@/lib/utils'

const EMPTY_SCENARIOS: Scenario[] = []
const EMPTY_AGENTS: Agent[] = []

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

const DEFAULT_BASH_SHEBANG = '#!/usr/bin/env bash'

type LibraryPanelProps = {
  search: string
  setSearch: (v: string) => void
  scope: 'all' | 'system' | 'custom'
  setScope: (v: 'all' | 'system' | 'custom') => void
  isLoading: boolean
  filteredScenarios: Scenario[]
  selectedId: string | null
  onSelectItem: (item: Scenario) => void
  onNewDraft: () => void
  onImportClick: () => void
  onExport: () => void
  exportDisabled: boolean
  operate: boolean
  total: number
  systemCount: number
  customCount: number
}

function ScenarioLibraryPanel({
  search,
  setSearch,
  scope,
  setScope,
  isLoading,
  filteredScenarios,
  selectedId,
  onSelectItem,
  onNewDraft,
  onImportClick,
  onExport,
  exportDisabled,
  operate,
  total,
  systemCount,
  customCount,
}: LibraryPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            placeholder="Имя, slug, теги…"
          />
        </div>
        <Select value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
          <SelectTrigger className="sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="system">Системные</SelectItem>
            <SelectItem value="custom">Свои</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button
        type="button"
        className="w-full justify-between"
        disabled={!operate}
        onClick={onNewDraft}
      >
        Новый сценарий
        <Plus className="size-4" />
      </Button>

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" disabled={!operate} onClick={onImportClick}>
          <Upload className="size-4" />
          Импорт
        </Button>
        <Button type="button" variant="outline" disabled={exportDisabled} onClick={onExport}>
          <Download className="size-4" />
          Экспорт
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{total} всего</Badge>
        <Badge variant="outline">{systemCount} системных</Badge>
        <Badge variant="outline">{customCount} своих</Badge>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : filteredScenarios.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ничего не найдено. Смените фильтр или создайте сценарий.
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
              onClick={() => onSelectItem(item)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.name}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{item.slug}</p>
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
    </div>
  )
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
  const [activeTab, setActiveTab] = useState('overview')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  /** Первая строка скрипта. Пустое значение — на агент уходит только тело. */
  const [bashShebang, setBashShebang] = useState(DEFAULT_BASH_SHEBANG)
  const [bashScriptBody, setBashScriptBody] = useState('')
  const [bashTimeoutText, setBashTimeoutText] = useState('300')

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

  const scenarios = scenariosQ.data ?? EMPTY_SCENARIOS
  const agents = agentsQ.data ?? EMPTY_AGENTS
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

  useEffect(() => {
    setActiveTab('overview')
  }, [selectedId])

  const selectedScenario = useMemo(
    () => scenarios.find((item) => item.id === selectedId) ?? null,
    [scenarios, selectedId],
  )

  useEffect(() => {
    if (!selectedScenario && activeTab === 'run') {
      setActiveTab('overview')
    }
  }, [activeTab, selectedScenario])

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

  const duplicateScenario = useMutation({
    mutationFn: async () => {
      const definition = parseJsonValue(draft.definitionText, 'Definition')
      const inputSchema = parseJsonValue(draft.inputSchemaText, 'Input schema')
      const baseSlug = draft.slug.trim()
      return api.createScenario({
        name: `${draft.name.trim()} Copy`,
        slug: baseSlug ? `${baseSlug}-copy` : undefined,
        description: draft.description,
        tags: draft.tagsText
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        status: 'draft',
        summary_template: draft.summaryTemplate || null,
        definition,
        input_schema: inputSchema,
      })
    },
    onSuccess: (item) => {
      toast.success('Сценарий продублирован')
      qc.invalidateQueries({ queryKey: qk.scenarios })
      setSelectedId(item.id)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Не удалось продублировать сценарий')
    },
  })

  const deleteScenario = useMutation({
    mutationFn: async () => {
      if (!draft.id) throw new Error('Нет сценария для удаления')
      return api.deleteScenario(draft.id)
    },
    onSuccess: () => {
      toast.success('Сценарий удалён')
      setDeleteDialogOpen(false)
      qc.invalidateQueries({ queryKey: qk.scenarios })
      setSelectedId(null)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Не удалось удалить сценарий')
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

  const runBashScript = useMutation({
    mutationFn: async () => {
      const raw = bashTimeoutText.trim()
      const parsed = raw === '' ? 300 : Number.parseInt(raw, 10)
      const timeout_secs = Number.isFinite(parsed)
        ? Math.min(3600, Math.max(1, parsed))
        : 300
      const body = bashScriptBody.trim()
      const shebangLine = bashShebang.trim()
      const script = shebangLine ? `${shebangLine}\n${body}` : body
      return api.runScriptTask(runAgentId, {
        script,
        timeout_secs,
      })
    },
    onSuccess: (task) => {
      toast.success('Скрипт поставлен в очередь')
      qc.invalidateQueries({ queryKey: qk.tasks })
      window.location.href = `/app/tasks/${task.id}`
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Не удалось запустить скрипт')
    },
  })

  const operate = canOperate()
  const parsedDefinition = definitionState.parsed
  const definitionError = definitionState.error
  const jsonTabIssue = Boolean(definitionError || inputSchemaError)

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
    setLibraryOpen(false)
  }

  function pickScenario(item: Scenario) {
    setSelectedId(item.id)
    setDraft(scenarioToDraft(item))
  }

  async function onImportInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      await importScenario(file)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось импортировать сценарий')
    }
  }

  const systemCount = scenarios.filter((item) => item.is_preset).length
  const customCount = scenarios.filter((item) => !item.is_preset).length

  const libraryProps: LibraryPanelProps = {
    search,
    setSearch,
    scope,
    setScope,
    isLoading: scenariosQ.isLoading,
    filteredScenarios,
    selectedId,
    onSelectItem: (item) => {
      pickScenario(item)
      setLibraryOpen(false)
    },
    onNewDraft: () => {
      setSelectedId(null)
      setDraft(emptyDraft())
      setLibraryOpen(false)
    },
    onImportClick: () => importRef.current?.click(),
    onExport: () => {
      if (selectedScenario) exportScenario(selectedScenario)
    },
    exportDisabled: !selectedScenario,
    operate,
    total: scenarios.length,
    systemCount,
    customCount,
  }

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch xl:gap-6">
      <input
        ref={importRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={onImportInputChange}
      />

      <aside className="hidden shrink-0 xl:block xl:w-[min(100%,320px)] 2xl:w-[min(100%,360px)]">
        <Card className="sticky top-3 flex max-h-[min(calc(100svh-5.5rem),56rem)] flex-col border-border/70">
          <CardHeader className="shrink-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <LibraryBig className="size-4" />
              Библиотека
            </CardTitle>
            <CardDescription className="text-sm leading-snug">
              Системные и свои сценарии. Логика в JSON DSL.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col pb-4">
            <ScenarioLibraryPanel {...libraryProps} />
          </CardContent>
        </Card>
      </aside>

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="flex max-h-[min(85dvh,36rem)] w-[calc(100vw-1.5rem)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-4 text-left sm:px-6">
            <DialogTitle className="flex items-center gap-2">
              <LibraryBig className="size-4" />
              Сценарии
            </DialogTitle>
            <DialogDescription className="text-left">
              Выберите сценарий или создайте новый.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <ScenarioLibraryPanel {...libraryProps} />
          </div>
        </DialogContent>
      </Dialog>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-center gap-2 xl:hidden"
            onClick={() => setLibraryOpen(true)}
          >
            <PanelLeftOpen className="size-4 shrink-0" />
            <span className="min-w-0 truncate">
              {draft.id ? draft.name : 'Черновик: ' + draft.name}
            </span>
          </Button>

          <Card className="w-full border-border/70">
            <CardContent className="space-y-3 p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold tracking-tight">{draft.name}</h2>
                    {draft.isPreset ? (
                      <Badge variant="secondary">Системный</Badge>
                    ) : draft.id ? (
                      <Badge variant="outline">Свой</Badge>
                    ) : (
                      <Badge variant="outline">Черновик</Badge>
                    )}
                    {draft.id && selectedScenario && (
                      <Badge variant="outline">v{selectedScenario.version}</Badge>
                    )}
                    <Badge variant="outline" className="font-normal">
                      {draft.status}
                    </Badge>
                  </div>
                  {selectedScenario && (
                    <p className="text-xs text-muted-foreground">
                      Создан {formatDateTime(selectedScenario.created_at)} · Обновлён{' '}
                      {formatDateTime(selectedScenario.updated_at)}
                      {draft.slug ? (
                        <>
                          {' '}
                          · <span className="font-mono">{draft.slug}</span>
                        </>
                      ) : null}
                    </p>
                  )}
                  {!selectedScenario && draft.slug ? (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{draft.slug}</span>
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 lg:shrink-0">
                  {selectedScenario?.is_preset && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={!operate || cloneScenario.isPending}
                      onClick={() => cloneScenario.mutate()}
                    >
                      <CopyPlus className="size-4" />
                      Клонировать в свой
                    </Button>
                  )}
                  {!draft.id && (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      disabled={
                        !operate ||
                        createScenario.isPending ||
                        Boolean(definitionError) ||
                        Boolean(inputSchemaError)
                      }
                      onClick={() => createScenario.mutate()}
                    >
                      <Plus className="size-4" />
                      Создать в библиотеке
                    </Button>
                  )}
                  {draft.id && !draft.isPreset && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          !operate ||
                          updateScenario.isPending ||
                          Boolean(definitionError) ||
                          Boolean(inputSchemaError)
                        }
                        onClick={() => updateScenario.mutate()}
                      >
                        <Save className="size-4" />
                        Сохранить
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                          !operate ||
                          duplicateScenario.isPending ||
                          Boolean(definitionError) ||
                          Boolean(inputSchemaError)
                        }
                        onClick={() => duplicateScenario.mutate()}
                      >
                        <CopyPlus className="size-4" />
                        Дублировать
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={!operate || deleteScenario.isPending}
                        onClick={() => setDeleteDialogOpen(true)}
                      >
                        <Trash2 className="size-4" />
                        Удалить
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
          <TabsList className="h-auto min-h-9 w-full flex-wrap justify-start gap-1 p-1">
            <TabsTrigger value="overview" className="flex-none">
              Обзор
            </TabsTrigger>
            <TabsTrigger value="steps" className="flex-none">
              Шаги
            </TabsTrigger>
            <TabsTrigger value="json" className="flex-none gap-1.5">
              JSON
              {jsonTabIssue ? (
                <span className="size-1.5 rounded-full bg-destructive" aria-hidden />
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="run" className="flex-none" disabled={!selectedScenario}>
              Запуск сценария
            </TabsTrigger>
            <TabsTrigger value="bash" className="flex-none gap-1.5">
              <Terminal className="size-3.5" aria-hidden />
              Bash
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0 focus-visible:ring-0">
            <Card className="border-border/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Метаданные</CardTitle>
                <CardDescription>Название, slug, теги, описание, шаблон сводки.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
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
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="scenario-description">Описание</Label>
                  <Textarea
                    id="scenario-description"
                    rows={4}
                    value={draft.description}
                    disabled={!operate || draft.isPreset}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, description: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="summary-template">Шаблон сводки</Label>
                  <Textarea
                    id="summary-template"
                    rows={3}
                    value={draft.summaryTemplate}
                    disabled={!operate || draft.isPreset}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, summaryTemplate: e.target.value }))
                    }
                    placeholder="Краткая сводка для результата запуска"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="steps" className="mt-0 focus-visible:ring-0">
            <Card className="border-border/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Шаги сценария</CardTitle>
                <CardDescription>
                  Визуальное редактирование. При ошибке JSON перейдите на вкладку «JSON».
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScenarioStepEditor
                  definition={parsedDefinition}
                  parseError={definitionError}
                  readOnly={!operate || draft.isPreset}
                  embedded
                  onChange={(definition) =>
                    setDraft((prev) => ({
                      ...prev,
                      definitionText: stringifyScenarioDefinition(definition),
                    }))
                  }
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="json" className="mt-0 focus-visible:ring-0">
            <Card className="border-border/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Definition и input schema</CardTitle>
                <CardDescription>Сырой JSON для точной настройки и отладки.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="definition-json">Definition JSON</Label>
                  <Textarea
                    id="definition-json"
                    rows={14}
                    className="min-h-48 font-mono text-xs"
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
                  <Label htmlFor="input-schema-json">Input schema JSON</Label>
                  <Textarea
                    id="input-schema-json"
                    rows={10}
                    className="min-h-32 font-mono text-xs"
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
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="run" className="mt-0 focus-visible:ring-0">
            {selectedScenario ? (
              <Card className="border-border/70">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Запуск на агенте</CardTitle>
                  <CardDescription>
                    Выберите агента и передайте входные данные в формате JSON.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:items-end">
                    <div className="space-y-2">
                      <Label>Агент</Label>
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
                    <div className="space-y-2 lg:col-span-1">
                      <Label htmlFor="run-inputs">Входные данные (JSON)</Label>
                      <Textarea
                        id="run-inputs"
                        rows={5}
                        className="min-h-24 font-mono text-xs"
                        value={runInputsText}
                        onChange={(e) => setRunInputsText(e.target.value)}
                        placeholder='{"targets":["1.1.1.1:443"]}'
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={!operate || !runAgentId || runScenario.isPending}
                      onClick={() => runScenario.mutate()}
                    >
                      <Play className="size-4" />
                      Запустить
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-muted-foreground">
                Сохраните сценарий или выберите существующий, чтобы запустить его.
              </p>
            )}
          </TabsContent>

          <TabsContent value="bash" className="mt-0 focus-visible:ring-0">
            <Card className="border-border/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Одноразовый bash на агенте</CardTitle>
                <CardDescription>
                  Тип <span className="font-mono text-xs">shell_script</span>: на агенте запускается{' '}
                  <span className="font-mono text-xs">bash -c</span> с полным текстом скрипта.
                  Shebang можно изменить или очистить (тогда уходит только тело).
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,220px)_minmax(0,140px)] sm:items-end">
                  <div className="space-y-2">
                    <Label>Агент</Label>
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
                    <Label htmlFor="bash-timeout">Таймаут (сек)</Label>
                    <Input
                      id="bash-timeout"
                      type="number"
                      min={1}
                      max={3600}
                      inputMode="numeric"
                      value={bashTimeoutText}
                      onChange={(e) => setBashTimeoutText(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bash-shebang">Shebang</Label>
                  <Input
                    id="bash-shebang"
                    className="font-mono text-xs"
                    value={bashShebang}
                    onChange={(e) => setBashShebang(e.target.value)}
                    placeholder={DEFAULT_BASH_SHEBANG}
                    spellCheck={false}
                  />
                  <Label htmlFor="bash-script">Команды</Label>
                  <Textarea
                    id="bash-script"
                    rows={12}
                    className="min-h-48 font-mono text-xs"
                    value={bashScriptBody}
                    onChange={(e) => setBashScriptBody(e.target.value)}
                    placeholder="ls -la"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={
                      !operate ||
                      !runAgentId ||
                      !bashScriptBody.trim() ||
                      runBashScript.isPending
                    }
                    onClick={() => runBashScript.mutate()}
                  >
                    <Play className="size-4" />
                    Запустить скрипт
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить сценарий?</DialogTitle>
            <DialogDescription>
              Сценарий «{draft.name}» будет безвозвратно удалён из базы. Системные сценарии удалить
              нельзя.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleteScenario.isPending}
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteScenario.isPending || !draft.id}
              onClick={() => deleteScenario.mutate()}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
