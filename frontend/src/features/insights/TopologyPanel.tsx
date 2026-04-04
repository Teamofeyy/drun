import { useQuery } from '@tanstack/react-query'
import '@xyflow/react/dist/style.css'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import type { CSSProperties } from 'react'
import { useEffect, useMemo } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { TopologyEdge, TopologyGraph, TopologyNode } from '@/api'
import { api } from '@/api'
import { qk } from '@/queryKeys'

const PLATFORM_ID = 'platform:infrahub'

const nodeColor: Record<string, string> = {
  platform: 'hsl(217 91% 56%)',
  agent: 'hsl(25 95% 53%)',
  site: 'hsl(200 70% 48%)',
  segment: 'hsl(280 55% 58%)',
  probe_target: 'hsl(45 85% 48%)',
  tcp_target: 'hsl(142 60% 42%)',
  reachability_target: 'hsl(45 85% 48%)',
}

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
        stroke: 'hsl(var(--muted-foreground) / 0.7)',
        strokeWidth: 1.2,
        strokeDasharray: '6 5',
      },
      label: e.kind === 'located_at' ? 'площадка' : 'сегмент',
    }
  }
  if (cat === 'observed_probe') {
    return {
      style: {
        stroke: 'hsl(38 92% 50% / 0.85)',
        strokeWidth: 1.4,
        strokeDasharray: '2 5',
      },
      label: 'TCP-проверка',
    }
  }
  return {
    style: { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1 },
    label: e.kind,
  }
}

/** Раскладка: платформа в центре, агенты по кругу, метаданные у центроидов, пробы рядом с агентом. */
function layoutTopology(g: TopologyGraph) {
  const cx = 520
  const cy = 340
  const agentRingR = 240
  const pos = new Map<string, { x: number; y: number }>()

  pos.set(PLATFORM_ID, { x: cx, y: cy })

  const agents = g.nodes.filter((n) => n.type === 'agent')
  const nA = agents.length
  agents.forEach((a, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nA, 1) - Math.PI / 2
    pos.set(a.id, {
      x: cx + agentRingR * Math.cos(angle),
      y: cy + agentRingR * Math.sin(angle),
    })
  })

  const metaTargets = new Set(
    g.edges
      .filter((e) => e.category === 'metadata')
      .map((e) => e.target),
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
    if (node.type !== 'probe_target' && node.type !== 'tcp_target' && node.type !== 'reachability_target')
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
    const sub = [n.sub, n.site, n.segment, n.role_tag]
      .filter(Boolean)
      .filter((x, i, a) => a.indexOf(x) === i)
      .join('\n')
    const p = pos.get(n.id) ?? { x: 0, y: 0 }
    const isPlatform = t === 'platform'
    return {
      id: n.id,
      position: p,
      data: {
        label: sub ? `${n.label}\n${sub}` : n.label,
      },
      style: {
        background: nodeColor[t] ?? 'hsl(var(--muted))',
        color: isPlatform ? '#fff' : '#0a0a0a',
        fontSize: isPlatform ? 13 : 11,
        fontWeight: isPlatform ? 700 : 500,
        borderRadius: 10,
        padding: isPlatform ? 14 : 9,
        minWidth: isPlatform ? 160 : 110,
        maxWidth: 200,
        border: `2px solid ${isPlatform ? 'hsl(217 91% 40%)' : 'hsl(var(--border))'}`,
        textAlign: 'center' as const,
        whiteSpace: 'pre-line' as const,
        lineHeight: 1.25,
      },
    }
  })
}

function toFlowEdges(edges: TopologyEdge[]) {
  return edges.map((e, i) => {
    const { style, label } = edgeVisuals(e)
    return {
      id: `e-${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      label,
      style,
      labelStyle: {
        fill: 'hsl(var(--muted-foreground))',
        fontSize: 9,
        fontWeight: 500,
      },
      labelBgStyle: { fill: 'hsl(var(--card))', fillOpacity: 0.92 },
      labelBgPadding: [3, 2] as [number, number],
    }
  })
}

export function TopologyPanel() {
  const graphQ = useQuery({
    queryKey: qk.topology,
    queryFn: api.topologyGraph,
    refetchInterval: 45_000,
  })

  const { initialNodes, initialEdges } = useMemo(() => {
    const g = graphQ.data
    if (!g?.nodes?.length) {
      return { initialNodes: [], initialEdges: [] }
    }
    return layoutTopology(g)
  }, [graphQ.data])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  const legend = graphQ.data?.legend

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Топология</CardTitle>
        <CardDescription className="space-y-2">
          <span className="block">
            <strong className="text-foreground">Синие сплошные</strong> — связь агента с{' '}
            <strong>платформой</strong> (HTTPS: heartbeat, выдача задач, отчёты). Агенты{' '}
            <em>не</em> обмениваются данными друг с другом через InfraHub.
          </span>
          <span className="block text-muted-foreground">
            <strong className="text-foreground/90">Пунктир серый</strong> — площадка/сегмент
            (метаданные). <strong className="text-foreground/90">Пунктир жёлтый</strong> — из
            отчётов проверок: куда агент открывал TCP (диагностика), не «сеть между агентами».
          </span>
          {legend && (
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              <li>{legend.control_plane}</li>
              <li>{legend.metadata}</li>
              <li>{legend.observed_probe}</li>
            </ul>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {graphQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка графа…</p>
        ) : initialNodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет агентов — после регистрации появится узел платформы и агенты.
          </p>
        ) : (
          <div className="h-[580px] w-full rounded-lg border border-border bg-card">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.15}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={18} className="bg-muted/25" />
              <Controls className="!bg-card !border-border" />
              <MiniMap
                className="!bg-card !border-border"
                maskColor="rgba(0,0,0,0.45)"
              />
            </ReactFlow>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
