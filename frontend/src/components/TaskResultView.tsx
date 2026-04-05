import type { TaskResult } from '@/api'
import { isRecord } from '@/lib/guards'
import { cn } from '@/lib/utils'

type Props = {
  kind: string
  result: TaskResult | null | undefined
  taskError: string | null | undefined
}

export function TaskResultView({ kind, result, taskError }: Props) {
  if (taskError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
        <strong className="text-destructive">Ошибка выполнения</strong>
        <p className="mt-2 text-sm">{taskError}</p>
      </div>
    )
  }

  if (!result) {
    return (
      <p className="text-sm text-muted-foreground">
        Подробный результат появится после завершения задачи.
      </p>
    )
  }

  const data = result.data

  return (
    <div className="flex flex-col gap-4">
      {result.summary && (
        <div className="rounded-lg border border-primary/25 bg-muted/40 p-4">
          <strong className="text-foreground">Краткая сводка</strong>
          <p className="mt-2 text-sm text-muted-foreground">{result.summary}</p>
        </div>
      )}

      {result.exit_code != null && (
        <p className="text-sm text-muted-foreground">
          Код выхода: <strong>{result.exit_code}</strong>
        </p>
      )}

      {kind === 'system_info' && isRecord(data) && (
        <SystemInfoView data={data} />
      )}
      {kind === 'port_check' && isRecord(data) && (
        <PortCheckView data={data} />
      )}
      {kind === 'diagnostic' && isRecord(data) && (
        <DiagnosticView data={data} />
      )}
      {kind === 'network_reachability' && isRecord(data) && (
        <ReachView data={data} />
      )}
      {kind === 'check_bundle' && isRecord(data) && (
        <BundleView data={data} />
      )}
      {kind === 'scenario_run' && isRecord(data) && (
        <ScenarioRunView data={data} />
      )}
      {kind === 'file_upload' && isRecord(data) && (
        <FileUploadView data={data} />
      )}

      {(result.stdout || result.stderr) && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Вывод</h3>
          {result.stdout && (
            <pre className="max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs">
              {result.stdout}
            </pre>
          )}
          {result.stderr && (
            <pre className="max-h-64 overflow-auto rounded-lg border border-destructive/30 bg-destructive/10 p-3 font-mono text-xs text-destructive">
              {result.stderr}
            </pre>
          )}
        </section>
      )}

      <details className="rounded-lg border border-border bg-muted/20 p-4">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
          Полные данные (JSON)
        </summary>
        <pre className="mt-3 max-h-[420px] overflow-auto font-mono text-xs">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function cardClass(wide?: boolean) {
  return cn(
    'flex min-w-[160px] flex-col gap-1 rounded-lg border border-border bg-card p-4',
    wide && 'min-w-full basis-full',
  )
}

function SystemInfoView({ data }: { data: Record<string, unknown> }) {
  const hostname = String(data.hostname ?? '—')
  const os = String(data.os_long ?? data.os ?? '—')
  const kernel = data.kernel != null ? String(data.kernel) : '—'
  const arch = data.cpu_arch != null ? String(data.cpu_arch) : '—'
  const ips = Array.isArray(data.all_ip_addresses)
    ? (data.all_ip_addresses as unknown[]).map(String)
    : []
  const ifaces = Array.isArray(data.interfaces) ? data.interfaces : []
  const ramT = data.memory_total_bytes
  const ramU = data.memory_used_bytes
  const cpusN = data.cpus_logical
  const mounts = Array.isArray(data.disk_mounts) ? data.disk_mounts : []

  return (
    <div className="flex flex-wrap gap-3">
      <div className={cardClass()}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Hostname
        </span>
        <strong>{hostname}</strong>
      </div>
      <div className={cardClass(true)}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          ОС (версия)
        </span>
        <strong>{os}</strong>
      </div>
      <div className={cardClass()}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Ядро
        </span>
        <strong>{kernel}</strong>
      </div>
      <div className={cardClass()}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Архитектура
        </span>
        <strong>{arch}</strong>
      </div>
      {typeof ramT === 'number' && typeof ramU === 'number' && (
        <div className={cardClass(true)}>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Память
          </span>
          <strong>
            {Math.round(ramU / 1024 / 1024)} / {Math.round(ramT / 1024 / 1024)}{' '}
            MiB использовано
          </strong>
        </div>
      )}
      {typeof cpusN === 'number' && (
        <div className={cardClass()}>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Логических CPU
          </span>
          <strong>{cpusN}</strong>
        </div>
      )}
      {ips.length > 0 && (
        <div className={cardClass(true)}>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            IP-адреса на интерфейсах
          </span>
          <p className="font-mono text-xs break-all">{ips.join(', ')}</p>
        </div>
      )}
      {ifaces.length > 0 && (
        <div className={cardClass(true)}>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Сетевые интерфейсы
          </span>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="p-2 text-left font-medium">Имя</th>
                <th className="p-2 text-left font-medium">IP</th>
                <th className="p-2 text-left font-medium">RX байт</th>
                <th className="p-2 text-left font-medium">TX байт</th>
              </tr>
            </thead>
            <tbody>
              {ifaces.map((row, i) => {
                const r = row as Record<string, unknown>
                const ipList = Array.isArray(r.ip_addresses)
                  ? r.ip_addresses.map(String).join(', ')
                  : '—'
                return (
                  <tr key={i} className="border-b border-border/60">
                    <td className="p-2">{String(r.name ?? '')}</td>
                    <td className="p-2 font-mono text-xs">{ipList}</td>
                    <td className="p-2 font-mono">
                      {String(r.received_bytes ?? r.received ?? '')}
                    </td>
                    <td className="p-2 font-mono">
                      {String(r.transmitted_bytes ?? r.transmitted ?? '')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {mounts.length > 0 && (
        <div className={cardClass(true)}>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Диски (смонтированные)
          </span>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="p-2 text-left font-medium">Точка</th>
                <th className="p-2 text-left font-medium">Всего (ГБ)</th>
                <th className="p-2 text-left font-medium">Доступно (ГБ)</th>
              </tr>
            </thead>
            <tbody>
              {mounts.map((row, i) => {
                const r = row as Record<string, unknown>
                const mp = String(r.mount_point ?? r.mount ?? '')
                const tb = r.total_bytes
                const ab = r.available_bytes
                if (typeof tb === 'number' && typeof ab === 'number') {
                  return (
                    <tr key={i} className="border-b border-border/60">
                      <td className="p-2 font-mono text-xs">{mp}</td>
                      <td className="p-2">{(tb / 1e9).toFixed(1)}</td>
                      <td className="p-2">{(ab / 1e9).toFixed(1)}</td>
                    </tr>
                  )
                }
                return (
                  <tr key={i} className="border-b border-border/60">
                    <td className="p-2 font-mono text-xs">{mp}</td>
                    <td className="p-2">{String(r.total_gb ?? '')}</td>
                    <td className="p-2">{String(r.avail_gb ?? '')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PortCheckView({ data }: { data: Record<string, unknown> }) {
  const results = Array.isArray(data.results) ? data.results : []
  const to = data.timeout_secs
  return (
    <>
      {to != null && (
        <p className="text-xs text-muted-foreground">
          Таймаут TCP: {String(to)} с
        </p>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="p-2 text-left font-medium">Адрес</th>
            <th className="p-2 text-left font-medium">TCP</th>
            <th className="p-2 text-left font-medium">Время мс</th>
            <th className="p-2 text-left font-medium">Ошибка</th>
            <th className="p-2 text-left font-medium">DNS/resolved</th>
          </tr>
        </thead>
        <tbody>
          {results.map((row, i) => {
            const r = row as Record<string, unknown>
            const open = Boolean(r.open)
            const res = Array.isArray(r.resolved_endpoints)
              ? r.resolved_endpoints.map(String).join(', ')
              : '—'
            return (
              <tr key={i} className="border-b border-border/60">
                <td className="p-2 font-mono text-xs">
                  {String(r.address_tried ?? `${r.host}:${r.port}`)}
                </td>
                <td className="p-2">
                  <span
                    className={cn(
                      'inline-block rounded-md px-2 py-0.5 text-xs font-semibold uppercase',
                      open
                        ? 'bg-emerald-950/60 text-emerald-400'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {open ? 'OK' : 'нет'}
                  </span>
                </td>
                <td className="p-2 font-mono">
                  {r.connect_time_ms != null
                    ? Number(r.connect_time_ms).toFixed(1)
                    : '—'}
                </td>
                <td className="p-2 text-xs text-muted-foreground">
                  {String(r.error ?? '—')}
                </td>
                <td className="p-2 font-mono text-xs">{res}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function DiagnosticView({ data }: { data: Record<string, unknown> }) {
  const scenario = String(data.scenario ?? '')
  if (scenario === 'hostname') {
    return (
      <div className={cardClass(true)}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Hostname
        </span>
        <strong>{String(data.hostname ?? '')}</strong>
      </div>
    )
  }
  if (scenario === 'uname' || (data.line && scenario !== 'cpu_load')) {
    return (
      <div className={cardClass(true)}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Сводка ОС
        </span>
        <pre className="mt-1 whitespace-pre-wrap font-mono text-sm">
          {String(data.line ?? '')}
        </pre>
      </div>
    )
  }
  if (scenario === 'interfaces_summary' && Array.isArray(data.names)) {
    return (
      <div className={cardClass(true)}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Интерфейсы
        </span>
        <p>{data.names.map(String).join(', ')}</p>
      </div>
    )
  }
  if (scenario === 'memory_disks') {
    return (
      <div className="flex flex-wrap gap-3">
        <div className={cardClass()}>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            RAM (MiB)
          </span>
          <strong>
            {String(data.ram_used_mb ?? '')} / {String(data.ram_total_mb ?? '')}
          </strong>
        </div>
        <div className={cardClass()}>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Swap (MiB)
          </span>
          <strong>
            {String(data.swap_used_mb ?? '')} /{' '}
            {String(data.swap_total_mb ?? '')}
          </strong>
        </div>
        {Array.isArray(data.disk_mounts) && (
          <div className={cardClass(true)}>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Тома
            </span>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {(data.disk_mounts as unknown[]).map((row, i) => {
                  const r = row as Record<string, unknown>
                  return (
                    <tr key={i} className="border-b border-border/60">
                      <td className="py-1">{String(r.mount ?? '')}</td>
                      <td className="py-1 font-mono">
                        {String(r.avail_gb ?? '')} / {String(r.total_gb ?? '')}{' '}
                        ГБ
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }
  if (scenario === 'cpu_load') {
    const g = data.global_usage_percent
    const per = Array.isArray(data.per_cpu) ? data.per_cpu : []
    return (
      <div className={cardClass(true)}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Загрузка CPU
        </span>
        <p>
          <strong>Общая: {String(g ?? '')}%</strong>
        </p>
        <ul className="mt-2 text-sm text-muted-foreground">
          {per.map((row, i) => {
            const r = row as Record<string, unknown>
            return (
              <li key={i}>
                CPU {String(r.cpu ?? i)}: {String(r.usage_percent ?? '')}%
              </li>
            )
          })}
        </ul>
      </div>
    )
  }
  if (scenario === 'dns_lookup') {
    const addrs = Array.isArray(data.addresses)
      ? data.addresses.map(String)
      : []
    return (
      <div className={cardClass(true)}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          DNS
        </span>
        <p>
          <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
            {String(data.query ?? '')}
          </code>
        </p>
        <p className="mt-2 font-mono text-sm break-all">
          {addrs.join(', ') || '—'}
        </p>
      </div>
    )
  }
  return null
}

function ReachView({ data }: { data: Record<string, unknown> }) {
  const results = Array.isArray(data.results) ? data.results : []
  const to = data.timeout_secs
  return (
    <>
      {to != null && (
        <p className="text-xs text-muted-foreground">
          Таймаут: {String(to)} с
        </p>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="p-2 text-left font-medium">Цель</th>
            <th className="p-2 text-left font-medium">TCP</th>
            <th className="p-2 text-left font-medium">мс</th>
            <th className="p-2 text-left font-medium">Ошибка</th>
            <th className="p-2 text-left font-medium">Пример DNS</th>
          </tr>
        </thead>
        <tbody>
          {results.map((row, i) => {
            const r = row as Record<string, unknown>
            const ok = Boolean(r.reachable)
            const dns = Array.isArray(r.dns_sample)
              ? r.dns_sample.map(String).slice(0, 3).join(', ')
              : '—'
            return (
              <tr key={i} className="border-b border-border/60">
                <td className="p-2 font-mono text-xs">{String(r.target ?? '')}</td>
                <td className="p-2">
                  <span
                    className={cn(
                      'inline-block rounded-md px-2 py-0.5 text-xs font-semibold uppercase',
                      ok
                        ? 'bg-emerald-950/60 text-emerald-400'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {ok ? 'OK' : 'нет'}
                  </span>
                </td>
                <td className="p-2 font-mono">
                  {r.connect_time_ms != null
                    ? Number(r.connect_time_ms).toFixed(1)
                    : '—'}
                </td>
                <td className="p-2 text-xs text-muted-foreground">
                  {String(r.error ?? '—')}
                </td>
                <td className="p-2 font-mono text-xs">{dns}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function BundleView({ data }: { data: Record<string, unknown> }) {
  const template = String(data.template ?? '')
  const desc = String(data.description ?? '')
  const keys = Object.keys(data).filter(
    (k) => !['template', 'description'].includes(k),
  )
  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <strong>Шаблон: {template}</strong>
        <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      </div>
      {keys.map((k) => (
        <details
          key={k}
          className="rounded-lg border border-border p-3"
          open={keys.length <= 3}
        >
          <summary className="cursor-pointer text-sm font-medium">{k}</summary>
          <pre className="mt-2 max-h-72 overflow-auto font-mono text-xs">
            {JSON.stringify(data[k], null, 2)}
          </pre>
        </details>
      ))}
    </section>
  )
}

function ScenarioRunView({ data }: { data: Record<string, unknown> }) {
  const scenarioName = String(data.scenario_name ?? 'Scenario')
  const steps = Array.isArray(data.steps) ? data.steps : []

  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <strong>{scenarioName}</strong>
        <p className="mt-1 text-xs text-muted-foreground">
          Шагов: {steps.length}
        </p>
      </div>
      {steps.map((row, i) => {
        const step = row as Record<string, unknown>
        const status = String(step.status ?? 'unknown')
        return (
          <details
            key={String(step.id ?? i)}
            className="rounded-lg border border-border p-3"
            open
          >
            <summary className="cursor-pointer text-sm font-medium">
              {String(step.title ?? step.id ?? `step-${i + 1}`)} · {status}
            </summary>
            <div className="mt-3 space-y-2">
              {Boolean(step.summary) && (
                <p className="text-sm text-muted-foreground">
                  {String(step.summary)}
                </p>
              )}
              {Boolean(step.stdout) && (
                <pre className="max-h-48 overflow-auto rounded-lg bg-muted/40 p-3 font-mono text-xs">
                  {String(step.stdout)}
                </pre>
              )}
              <pre className="max-h-72 overflow-auto rounded-lg bg-muted/20 p-3 font-mono text-xs">
                {JSON.stringify(step.data ?? step, null, 2)}
              </pre>
            </div>
          </details>
        )
      })}
    </section>
  )
}

function FileUploadView({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="flex flex-wrap gap-3">
      <div className={cardClass(true)}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Путь назначения
        </span>
        <strong className="font-mono text-sm break-all">
          {String(data.destination_path ?? '—')}
        </strong>
      </div>
      <div className={cardClass()}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Имя файла
        </span>
        <strong>{String(data.filename ?? '—')}</strong>
      </div>
      <div className={cardClass()}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Размер
        </span>
        <strong>{String(data.bytes_written ?? '—')} bytes</strong>
      </div>
      <div className={cardClass()}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Overwrite
        </span>
        <strong>{String(Boolean(data.overwrite))}</strong>
      </div>
    </div>
  )
}
