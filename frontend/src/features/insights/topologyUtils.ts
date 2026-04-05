import type { TopologyEdge, TopologyGraph, TopologyNode } from '@/api'
import { isRecord } from '@/lib/guards'

export const TOPOLOGY_PLATFORM_ID = 'platform:infrahub'

function parseNode(raw: unknown): TopologyNode | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : null
  const label = typeof raw.label === 'string' ? raw.label : null
  const type = typeof raw.type === 'string' ? raw.type : null
  if (!id || !label || !type) return null
  const n: TopologyNode = { id, label, type }
  if (typeof raw.agent_status === 'string') n.agent_status = raw.agent_status
  if (typeof raw.hostname === 'string') n.hostname = raw.hostname
  if (typeof raw.primary_ip === 'string') n.primary_ip = raw.primary_ip
  if (typeof raw.os_long === 'string') n.os_long = raw.os_long
  if (typeof raw.sub === 'string') n.sub = raw.sub
  if (typeof raw.site === 'string') n.site = raw.site
  if (typeof raw.segment === 'string') n.segment = raw.segment
  if (typeof raw.role_tag === 'string') n.role_tag = raw.role_tag
  return n
}

function parseEdge(raw: unknown): TopologyEdge | null {
  if (!isRecord(raw)) return null
  const source = typeof raw.source === 'string' ? raw.source : null
  const target = typeof raw.target === 'string' ? raw.target : null
  const kind = typeof raw.kind === 'string' ? raw.kind : null
  if (!source || !target || !kind) return null
  const e: TopologyEdge = { source, target, kind }
  if (typeof raw.category === 'string') e.category = raw.category
  if (typeof raw.detail === 'string') e.detail = raw.detail
  return e
}

/* Cold path: unknown API body → validated graph or null. */
export function normalizeTopologyGraph(raw: unknown): TopologyGraph | null {
  if (!isRecord(raw)) return null
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null

  const nodes: TopologyNode[] = []
  for (const item of raw.nodes) {
    const n = parseNode(item)
    if (n) nodes.push(n)
  }

  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges: TopologyEdge[] = []
  for (const item of raw.edges) {
    const e = parseEdge(item)
    if (!e) continue
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue
    edges.push(e)
  }

  let legend: TopologyGraph['legend']
  if (isRecord(raw.legend)) {
    const l = raw.legend
    const control_plane =
      typeof l.control_plane === 'string' ? l.control_plane : undefined
    const metadata = typeof l.metadata === 'string' ? l.metadata : undefined
    const observed_probe =
      typeof l.observed_probe === 'string' ? l.observed_probe : undefined
    if (control_plane && metadata && observed_probe) {
      legend = { control_plane, metadata, observed_probe }
    }
  }

  return { nodes, edges, legend }
}

const PROBE_NODE_TYPES = new Set([
  'probe_target',
  'tcp_target',
  'reachability_target',
])

export function isProbeNode(n: TopologyNode): boolean {
  return PROBE_NODE_TYPES.has(n.type)
}

/* Caller must ensure: g normalized. */
export function withoutProbes(g: TopologyGraph): TopologyGraph {
  const nodes = g.nodes.filter((n) => !isProbeNode(n))
  const edges = g.edges.filter((e) => e.category !== 'observed_probe')
  return { ...g, nodes, edges }
}

/* Caller must ensure: edges from normalized graph. */
export function stableEdgeIds(edges: TopologyEdge[]): string[] {
  const order = edges.map((_, i) => i)
  order.sort((ia, ib) => {
    const a = edges[ia]
    const b = edges[ib]
    const sa = `${a.source}\0${a.target}\0${a.kind}\0${a.category ?? ''}\0${a.detail ?? ''}`
    const sb = `${b.source}\0${b.target}\0${b.kind}\0${b.category ?? ''}\0${b.detail ?? ''}`
    if (sa !== sb) return sa < sb ? -1 : 1
    return ia - ib
  })
  const baseCount = new Map<string, number>()
  const idByOrigIndex: string[] = new Array(edges.length)
  for (const origIdx of order) {
    const e = edges[origIdx]
    const base = `${e.source}|${e.target}|${e.kind}`
    const n = baseCount.get(base) ?? 0
    baseCount.set(base, n + 1)
    idByOrigIndex[origIdx] = n === 0 ? `e:${base}` : `e:${base}#${n}`
  }
  return idByOrigIndex
}

export function countAgents(g: TopologyGraph): number {
  return g.nodes.filter((n) => n.type === 'agent').length
}

export function countProbeVisualization(g: TopologyGraph): {
  nodes: number
  edges: number
} {
  const nodes = g.nodes.filter((n) => isProbeNode(n)).length
  const edges = g.edges.filter((e) => e.category === 'observed_probe').length
  return { nodes, edges }
}
