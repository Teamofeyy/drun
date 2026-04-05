export const SCENARIO_STEP_TYPES = [
  'system_info',
  'diagnostic',
  'hostname',
  'cpu_load',
  'memory_disks',
  'dns_lookup',
  'port_check',
  'network_reachability',
  'check_bundle',
] as const

export type ScenarioStepType = (typeof SCENARIO_STEP_TYPES)[number]

export type ScenarioStep = {
  id: string
  title: string
  type: ScenarioStepType
  params: Record<string, unknown>
}

export type ScenarioDefinition = {
  inputs: Record<string, unknown>
  steps: ScenarioStep[]
}

export const STEP_LABELS: Record<ScenarioStepType, string> = {
  system_info: 'Системная информация',
  diagnostic: 'Диагностический сценарий',
  hostname: 'Hostname',
  cpu_load: 'CPU Load',
  memory_disks: 'Memory & Disks',
  dns_lookup: 'DNS Lookup',
  port_check: 'Port Check',
  network_reachability: 'Reachability',
  check_bundle: 'Bundle Template',
}

export function defaultParamsForType(type: ScenarioStepType): Record<string, unknown> {
  switch (type) {
    case 'diagnostic':
      return { scenario: 'memory_disks' }
    case 'dns_lookup':
      return { host: 'cloudflare.com' }
    case 'port_check':
      return { targets: [{ host: '127.0.0.1', port: 8080 }], timeout_secs: 5 }
    case 'network_reachability':
      return { targets: ['1.1.1.1:443'], timeout_secs: 5 }
    case 'check_bundle':
      return { template: 'node_baseline' }
    default:
      return {}
  }
}

export function defaultTitleForType(type: ScenarioStepType): string {
  return STEP_LABELS[type]
}

export function createStep(type: ScenarioStepType, index: number): ScenarioStep {
  return {
    id: `step-${index + 1}`,
    title: defaultTitleForType(type),
    type,
    params: defaultParamsForType(type),
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isStepType(v: unknown): v is ScenarioStepType {
  return typeof v === 'string' && SCENARIO_STEP_TYPES.includes(v as ScenarioStepType)
}

function coerceStep(raw: unknown, index: number): ScenarioStep | null {
  if (!isRecord(raw)) return null
  const type = isStepType(raw.type) ? raw.type : null
  if (!type) return null
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : `step-${index + 1}`,
    title:
      typeof raw.title === 'string' && raw.title.trim()
        ? raw.title
        : defaultTitleForType(type),
    type,
    params: isRecord(raw.params) ? raw.params : defaultParamsForType(type),
  }
}

export function coerceScenarioDefinition(raw: unknown): ScenarioDefinition {
  if (!isRecord(raw)) {
    return { inputs: {}, steps: [createStep('system_info', 0)] }
  }

  const inputs = isRecord(raw.inputs) ? raw.inputs : {}
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : []
  const steps = stepsRaw
    .map((step, index) => coerceStep(step, index))
    .filter((step): step is ScenarioStep => step !== null)

  return {
    inputs,
    steps: steps.length > 0 ? steps : [createStep('system_info', 0)],
  }
}

export function parseScenarioDefinitionText(text: string): ScenarioDefinition {
  return coerceScenarioDefinition(JSON.parse(text))
}

export function stringifyScenarioDefinition(definition: ScenarioDefinition): string {
  return JSON.stringify(
    {
      inputs: definition.inputs,
      steps: definition.steps.map((step) => ({
        id: step.id,
        type: step.type,
        title: step.title,
        ...(Object.keys(step.params).length > 0 ? { params: step.params } : {}),
      })),
    },
    null,
    2,
  )
}
