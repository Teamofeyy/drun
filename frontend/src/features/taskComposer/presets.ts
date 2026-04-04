export const TASK_KINDS = [
  'system_info',
  'port_check',
  'diagnostic',
  'network_reachability',
  'check_bundle',
] as const

export type TaskKind = (typeof TASK_KINDS)[number]

export function defaultPayloadTextForKind(kind: TaskKind): string {
  switch (kind) {
    case 'port_check':
      return JSON.stringify(
        {
          targets: [{ host: '127.0.0.1', port: 8080 }],
          timeout_secs: 5,
        },
        null,
        2,
      )
    case 'diagnostic':
      return JSON.stringify({ scenario: 'memory_disks' }, null, 2)
    case 'network_reachability':
      return JSON.stringify(
        { targets: ['1.1.1.1:443', '127.0.0.1:8080'], timeout_secs: 5 },
        null,
        2,
      )
    case 'check_bundle':
      return JSON.stringify({ template: 'node_baseline' }, null, 2)
    default:
      return '{}'
  }
}

export const KIND_LABELS: Record<TaskKind, string> = {
  system_info: 'Информация о системе',
  port_check: 'Проверка TCP-портов',
  diagnostic: 'Диагностика (сценарии)',
  network_reachability: 'Достижимость сети',
  check_bundle: 'Набор проверок (payload)',
}

/** Кратко что делает проверка — один источник правды вместо отдельных «сценариев» */
export const KIND_DESCRIPTIONS: Record<TaskKind, string> = {
  system_info: 'Hostname, ОС, CPU, RAM, сеть, диски',
  port_check: 'TCP к 127.0.0.1:8080 — подстройте хост/порт в JSON',
  diagnostic: 'Сценарий memory_disks (RAM, swap, тома)',
  network_reachability: '1.1.1.1:443 и 127.0.0.1:8080 — правьте цели в JSON',
  check_bundle: 'Шаблон node_baseline из whitelist агента (или свой template в JSON)',
}
