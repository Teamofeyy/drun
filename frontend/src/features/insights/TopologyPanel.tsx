import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import '@xyflow/react/dist/style.css'
import './topologyFlow.css'
import {
  Background,
  BezierEdge,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import type { CSSProperties } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import type { TopologyEdge, TopologyGraph, TopologyNode } from '@/api'
import { api, canOperate } from '@/api'
import { qk } from '@/queryKeys'
import { cn } from '@/lib/utils'
import {
  TOPOLOGY_PLATFORM_ID,
  countAgents,
  countProbeVisualization,
  normalizeTopologyGraph,
  stableEdgeIds,
  withoutProbes,
} from './topologyUtils'
import { ProvisionAgentDialog } from './ProvisionAgentDialog'
import { UninstallAgentDialog } from './UninstallAgentDialog'

const nodeColor: Record<string, string> = {
  platform: 'hsl(217 91% 56%)',
  agent: 'var(--card)',
  site: 'hsl(200 70% 48%)',
  segment: 'hsl(280 55% 58%)',
  probe_target: 'hsl(45 85% 48%)',
}

type TopologyFlowNode = Node<{
  label: string
  sub?: string
  agentStatus?: string
  hostname?: string
  primaryIp?: string
  osLong?: string
  type: string
}>

function statusTone(status?: string) {
  switch (status) {
    case 'online':
      return {
        dot: 'bg-emerald-500',
        border: 'hsl(145 63% 42%)',
        glow: '0 0 0 3px rgba(16,185,129,0.12)',
      }
    case 'busy':
      return {
        dot: 'bg-amber-500',
        border: 'hsl(38 92% 50%)',
        glow: '0 0 0 3px rgba(245,158,11,0.14)',
      }
    default:
      return {
        dot: 'bg-slate-400',
        border: 'var(--border)',
        glow: 'none',
      }
  }
}

/**
 * Нужны Handle с классами source/target: иначе @xyflow не считает handleBounds и рёбра не рисуются.
 * Визуально скрываем в topologyFlow.css (.topology-invisible-handle).
 */
function TopologyPlainNode({ data }: NodeProps<TopologyFlowNode>) {
  const isPlatform = data.type === 'platform'
  const tone = statusTone(data.agentStatus)
  const lines = [
    data.hostname && data.hostname !== data.label ? data.hostname : undefined,
    data.primaryIp,
    data.osLong,
    data.sub,
  ].filter(Boolean) as string[]

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="topology-invisible-handle"
      />
      <div className="relative text-left">
        {!isPlatform && data.type === 'agent' && (
          <span
            className={cn(
              'absolute -right-1 -top-1 size-3 rounded-full border border-white shadow-sm',
              tone.dot,
            )}
            title={`agent: ${data.agentStatus ?? 'offline'}`}
          />
        )}
        <div className={cn('font-medium', isPlatform && 'text-center')}>
          {data.label}
        </div>
        {lines.length > 0 && (
          <div
            className={cn(
              'mt-1 space-y-0.5 text-[10px] leading-[1.25] opacity-85',
              isPlatform && 'text-center',
            )}
          >
            {lines.map((line) => (
              <div key={line} className="break-words">
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="topology-invisible-handle"
      />
    </>
  )
}

function TopologyBezierEdge(props: EdgeProps) {
  const detail =
    props.data && typeof (props.data as { detail?: unknown }).detail === 'string'
      ? (props.data as { detail: string }).detail
      : undefined
  return (
    <g className="topology-edge">
      {detail ? <title>{detail}</title> : null}
      <BezierEdge {...props} />
    </g>
  )
}

const topologyNodeTypes = { default: TopologyPlainNode }
const topologyEdgeTypes = { default: TopologyBezierEdge }

function edgeVisuals(e: TopologyEdge): {
  style: CSSProperties
  label?: string
} {
  const cat = e.category
  if (cat === 'control_plane') {
    return {
      style: {
        stroke: 'hsl(217 91% 60%)',
        strokeWidth: 2.5,
      },
      label: '→ API',
    }
  }
  if (cat === 'metadata') {
    return {
      style: {
        stroke: 'var(--muted-foreground)',
        strokeOpacity: 0.72,
        strokeWidth: 1.2,
        strokeDasharray: '6 5',
      },
      label: e.kind === 'located_at' ? 'площадка' : 'сегмент',
    }
  }
  if (cat === 'observed_probe') {
    const probeLabel =
      e.kind === 'reachability_probe'
        ? 'связность'
        : e.kind === 'tcp_probe'
          ? 'TCP-проверка'
          : e.kind
    return {
      style: {
        stroke: 'hsl(38 92% 50% / 0.85)',
        strokeWidth: 1.4,
        strokeDasharray: '2 5',
      },
      label: probeLabel,
    }
  }
  return {
    style: { stroke: 'var(--muted-foreground)', strokeWidth: 1 },
    label: e.kind,
  }
}

/* Assumes: g from normalizeTopologyGraph; one flow node per input node. */
function layoutTopology(g: TopologyGraph) {
  const cx = 560
  const cy = 360
  const agents = g.nodes.filter((n) => n.type === 'agent')
  const nA = agents.length
  const agentRingR = Math.max(160, Math.min(440, 72 + nA * 26))

  const pos = new Map<string, { x: number; y: number }>()

  pos.set(TOPOLOGY_PLATFORM_ID, { x: cx, y: cy })

  agents.forEach((a, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nA, 1) - Math.PI / 2
    pos.set(a.id, {
      x: cx + agentRingR * Math.cos(angle),
      y: cy + agentRingR * Math.sin(angle),
    })
  })

  const metaTargets = new Set(
    g.edges.filter((e) => e.category === 'metadata').map((e) => e.target),
  )

  for (const node of g.nodes) {
    if (node.type !== 'site' && node.type !== 'segment') continue
    if (!metaTargets.has(node.id)) continue
    const sources = g.edges
      .filter((e) => e.target === node.id && e.category === 'metadata')
      .map((e) => e.source)
    let sx = 0
    let sy = 0
    let c = 0
    for (const s of sources) {
      const p = pos.get(s)
      if (p) {
        sx += p.x
        sy += p.y
        c++
      }
    }
    if (c > 0) {
      const dx = node.type === 'site' ? -100 : 100
      const dy = node.type === 'site' ? -40 : 40
      pos.set(node.id, { x: sx / c + dx, y: sy / c + dy })
    } else {
      pos.set(node.id, { x: cx + 380, y: cy })
    }
  }

  const probePerAgent = new Map<string, number>()
  for (const node of g.nodes) {
    if (
      node.type !== 'probe_target' &&
      node.type !== 'tcp_target' &&
      node.type !== 'reachability_target'
    )
      continue
    const edge = g.edges.find(
      (e) => e.target === node.id && e.category === 'observed_probe',
    )
    const src = edge?.source
    if (src && pos.has(src)) {
      const base = pos.get(src)!
      const k = (probePerAgent.get(src) ?? 0) + 1
      probePerAgent.set(src, k)
      const spread = 48
      pos.set(node.id, {
        x: base.x + k * spread * 0.85,
        y: base.y + agentRingR * 0.35 + k * 12,
      })
    } else if (!pos.has(node.id)) {
      pos.set(node.id, { x: cx + 420, y: cy + 180 })
    }
  }

  for (const node of g.nodes) {
    if (!pos.has(node.id)) {
      pos.set(node.id, { x: cx + 460, y: cy + 40 })
    }
  }

  const initialNodes = toFlowNodes(g.nodes, pos)
  const initialEdges = toFlowEdges(g.edges)
  return { initialNodes, initialEdges }
}

function toFlowNodes(
  raw: TopologyNode[],
  pos: Map<string, { x: number; y: number }>,
) {
  return raw.map((n) => {
    const t = n.type
    const sub = [n.site, n.segment, n.role_tag, n.sub]
      .filter(Boolean)
      .filter((x, i, a) => a.indexOf(x) === i)
      .join('\n')
    const p = pos.get(n.id) ?? { x: 0, y: 0 }
    const isPlatform = t === 'platform'
    const tone = statusTone(n.agent_status)
    return {
      id: n.id,
      position: p,
      data: {
        label: n.label,
        sub: sub || undefined,
        type: t,
        agentStatus: n.agent_status,
        hostname: n.hostname,
        primaryIp: n.primary_ip,
        osLong: n.os_long,
      },
      style: {
        background: nodeColor[t] ?? 'var(--muted)',
        color: isPlatform ? '#fff' : 'var(--foreground)',
        fontSize: isPlatform ? 13 : 11,
        fontWeight: isPlatform ? 700 : 500,
        borderRadius: 10,
        padding: isPlatform ? 14 : 10,
        minWidth: isPlatform ? 160 : 110,
        maxWidth: t === 'agent' ? 230 : 200,
        border: `2px solid ${isPlatform ? 'hsl(217 91% 40%)' : t === 'agent' ? tone.border : 'var(--border)'}`,
        boxShadow: t === 'agent' ? tone.glow : 'none',
        textAlign: isPlatform ? ('center' as const) : ('left' as const),
        lineHeight: 1.25,
      },
    }
  })
}

function toFlowEdges(edges: TopologyEdge[]) {
  const ids = stableEdgeIds(edges)
  return edges.map((e, i) => {
    const { style, label } = edgeVisuals(e)
    return {
      id: ids[i]!,
      source: e.source,
      target: e.target,
      label,
      style,
      data: e.detail ? { detail: e.detail } : undefined,
      labelStyle: {
        fill: 'var(--muted-foreground)',
        fontSize: 9,
        fontWeight: 500,
      },
      labelBgStyle: { fill: 'var(--card)', fillOpacity: 0.93 },
      labelBgPadding: [3, 2] as [number, number],
    }
  })
}

type FlowPayload = {
  initialNodes: ReturnType<typeof toFlowNodes>
  initialEdges: ReturnType<typeof toFlowEdges>
  graphForLayout: TopologyGraph
  agentCount: number
}

function buildFlowPayload(
  graph: TopologyGraph,
  showProbes: boolean,
): FlowPayload | null {
  const graphForLayout = showProbes ? graph : withoutProbes(graph)
  if (graphForLayout.nodes.length === 0) return null
  const { initialNodes, initialEdges } = layoutTopology(graphForLayout)
  return {
    initialNodes,
    initialEdges,
    graphForLayout,
    agentCount: countAgents(graphForLayout),
  }
}

type TopologyPanelModel =
  | { tag: 'pending' }
  | {
      tag: 'error'
      message: string
      refetch: () => void
      staleFlow: FlowPayload | null
      legend?: TopologyGraph['legend']
    }
  | { tag: 'malformed' }
  | { tag: 'empty'; graph: TopologyGraph }
  | {
      tag: 'ready'
      graph: TopologyGraph
      flow: FlowPayload
      legend?: TopologyGraph['legend']
      probeStats: ReturnType<typeof countProbeVisualization>
      showProbeToggle: boolean
    }

/** Единственное место чтения флагов запроса для панели топологии. */
function deriveTopologyPanelModel(
  q: UseQueryResult<TopologyGraph | null>,
  showProbes: boolean,
): TopologyPanelModel {
  const data = q.data
  const refetch = () => {
    void q.refetch()
  }

  if (q.isError) {
    const message =
      q.error instanceof Error
        ? q.error.message
        : 'Не удалось загрузить топологию'
    let staleFlow: FlowPayload | null = null
    if (data && data.nodes.length > 0) {
      staleFlow = buildFlowPayload(data, showProbes)
    }
    return {
      tag: 'error',
      message,
      refetch,
      staleFlow,
      legend: data?.legend,
    }
  }

  if (q.isPending) {
    return { tag: 'pending' }
  }

  if (data === null) {
    return { tag: 'malformed' }
  }

  if (data === undefined) {
    return { tag: 'pending' }
  }

  if (data.nodes.length === 0) {
    return { tag: 'empty', graph: data }
  }

  const flow = buildFlowPayload(data, showProbes)
  if (!flow) {
    return { tag: 'empty', graph: data }
  }

  const probeStats = countProbeVisualization(data)
  const showProbeToggle = probeStats.nodes > 0 || probeStats.edges > 0

  return {
    tag: 'ready',
    graph: data,
    flow,
    legend: data.legend,
    probeStats,
    showProbeToggle,
  }
}

function topologyHeaderLegend(
  m: TopologyPanelModel,
): TopologyGraph['legend'] | undefined {
  switch (m.tag) {
    case 'ready':
      return m.legend
    case 'empty':
      return m.graph.legend
    case 'error':
      return m.legend
    default:
      return undefined
  }
}

function TopologyFitViewTrigger({
  nodesLen,
  edgesLen,
}: {
  nodesLen: number
  edgesLen: number
}) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    if (nodesLen === 0) return
    const id = requestAnimationFrame(() => {
      fitView({ padding: 0.18, duration: 220 })
    })
    return () => cancelAnimationFrame(id)
  }, [fitView, nodesLen, edgesLen])
  return null
}

function TopologyFlowView({
  initialNodes,
  initialEdges,
}: {
  initialNodes: ReturnType<typeof toFlowNodes>
  initialEdges: ReturnType<typeof toFlowEdges>
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes((prev) => {
      if (prev.length === 0) return initialNodes
      const posById = new Map(prev.map((n) => [n.id, n.position]))
      return initialNodes.map((n) => ({
        ...n,
        position: posById.get(n.id) ?? n.position,
      }))
    })
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  return (
    <div className="topology-flow-shell h-[clamp(420px,62vh,700px)] w-full min-h-[420px] rounded-lg border border-border bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={topologyNodeTypes}
        edgeTypes={topologyEdgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.12}
        maxZoom={1.75}
        onlyRenderVisibleElements
        nodesConnectable={false}
        edgesReconnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <TopologyFitViewTrigger
          nodesLen={initialNodes.length}
          edgesLen={initialEdges.length}
        />
        <Background gap={18} className="bg-muted/25" />
        <Controls showInteractive={false} />
        <MiniMap maskColor="rgba(0,0,0,0.45)" />
      </ReactFlow>
    </div>
  )
}

export function TopologyPanel() {
  const [showProbes, setShowProbes] = useState(true)
  const [provisionOpen, setProvisionOpen] = useState(false)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const operate = canOperate()

  const graphQ = useQuery({
    queryKey: qk.topology,
    queryFn: api.topologyGraph,
    refetchInterval: 300_000,
    select: (raw) => normalizeTopologyGraph(raw as unknown),
  })

  const model = useMemo(
    () => deriveTopologyPanelModel(graphQ, showProbes),
    [graphQ, showProbes],
  )

  const legend = topologyHeaderLegend(model)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Топология</CardTitle>
        <div
          className={cn('text-sm text-muted-foreground space-y-2')}
        >
          <span className="block">
            <strong className="text-foreground">Синие сплошные</strong> — связь агента с{' '}
            <strong>платформой</strong> (HTTPS: heartbeat, выдача задач, отчёты). Агенты{' '}
            <em>не</em> обмениваются данными друг с другом через InfraHub.
          </span>
          <span className="block text-muted-foreground">
            <strong className="text-foreground/90">Пунктир серый</strong> — площадка/сегмент
            (метаданные). <strong className="text-foreground/90">Пунктир жёлтый</strong> — из
            отчётов проверок (TCP-порт и проверки связности), это не «сеть между агентами».
          </span>
          {legend && (
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              <li>{legend.control_plane}</li>
              <li>{legend.metadata}</li>
              <li>{legend.observed_probe}</li>
            </ul>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {operate && (
          <>
            <ProvisionAgentDialog
              open={provisionOpen}
              onOpenChange={setProvisionOpen}
            />
            <UninstallAgentDialog
              open={uninstallOpen}
              onOpenChange={setUninstallOpen}
            />
          </>
        )}
        {renderTopologyToolbar(
          model,
          showProbes,
          setShowProbes,
          operate,
          () => setProvisionOpen(true),
          () => setUninstallOpen(true),
        )}
        {renderTopologyBody(model)}
      </CardContent>
    </Card>
  )
}

function renderTopologyToolbar(
  model: TopologyPanelModel,
  showProbes: boolean,
  setShowProbes: (v: boolean) => void,
  operate: boolean,
  onOpenProvision: () => void,
  onOpenUninstall: () => void,
) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {operate && (
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenProvision}
          >
            Установить агента…
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
            onClick={onOpenUninstall}
          >
            Снять агента с ноды…
          </Button>
        </>
      )}
      {model.tag === 'ready' && model.showProbeToggle && (
        <div className="flex max-w-xl flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex items-center gap-2">
            <input
              id="topology-probes"
              type="checkbox"
              checked={showProbes}
              onChange={(e) => setShowProbes(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <Label
              htmlFor="topology-probes"
              className="cursor-pointer text-sm font-normal text-foreground"
              title={`Узлов целей: ${model.probeStats.nodes}, рёбер к ним: ${model.probeStats.edges}`}
            >
              Показывать цели из отчётов проверок
            </Label>
          </div>
          <span className="text-xs text-muted-foreground sm:max-w-md">
            Снимите галочку, чтобы убрать жёлтые узлы и рёбра — останутся платформа,
            агенты и серая метаданная часть. Появляются из завершённых{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[0.7rem]">
              port_check
            </code>{' '}
            и{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[0.7rem]">
              network_reachability
            </code>
            .
          </span>
        </div>
      )}
      {model.tag === 'ready' && !model.showProbeToggle && (
        <p className="max-w-xl text-xs text-muted-foreground">
          В последних отчётах нет целей проверок — на графе только платформа, агенты и
          метаданные. После завершённых задач{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[0.7rem]">
            port_check
          </code>{' '}
          /{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[0.7rem]">
            network_reachability
          </code>{' '}
          появятся жёлтые узлы и переключатель «упростить граф».
        </p>
      )}
    </div>
  )
}

function renderTopologyBody(model: TopologyPanelModel) {
  switch (model.tag) {
    case 'pending':
      return (
        <p className="text-sm text-muted-foreground">Загрузка графа…</p>
      )
    case 'error':
      return (
        <>
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
            <p className="mb-3 text-destructive">{model.message}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => model.refetch()}
            >
              Повторить
            </Button>
          </div>
          {model.staleFlow && (
            <>
              {model.staleFlow.agentCount === 0 && (
                <p className="text-sm text-muted-foreground">
                  Зарегистрированных агентов нет — на графе только узел платформы InfraHub.
                </p>
              )}
              <ReactFlowProvider>
                <TopologyFlowView
                  initialNodes={model.staleFlow.initialNodes}
                  initialEdges={model.staleFlow.initialEdges}
                />
              </ReactFlowProvider>
            </>
          )}
        </>
      )
    case 'malformed':
      return (
        <p className="text-sm text-destructive">
          Ответ API топологии неожиданного формата (ожидались массивы nodes и edges).
        </p>
      )
    case 'empty':
      return (
        <p className="text-sm text-muted-foreground">
          В ответе нет ни одного узла графа.
        </p>
      )
    case 'ready':
      return (
        <>
          {model.flow.agentCount === 0 && (
            <p className="text-sm text-muted-foreground">
              Зарегистрированных агентов нет — на графе только узел платформы InfraHub.
            </p>
          )}
          <ReactFlowProvider>
            <TopologyFlowView
              initialNodes={model.flow.initialNodes}
              initialEdges={model.flow.initialEdges}
            />
          </ReactFlowProvider>
        </>
      )
  }
}
