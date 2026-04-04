import type { TaskResult } from '../api'

type Props = {
  kind: string
  result: TaskResult | null | undefined
  taskError: string | null | undefined
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function TaskResultView({ kind, result, taskError }: Props) {
  if (taskError) {
    return (
      <div className="callout error">
        <strong>Ошибка выполнения</strong>
        <p>{taskError}</p>
      </div>
    )
  }

  if (!result) {
    return (
      <p className="muted">
        Подробный результат появится после завершения задачи.
      </p>
    )
  }

  const data = result.data

  return (
    <div className="result-stack">
      {result.summary && (
        <div className="callout summary-callout">
          <strong>Краткая сводка</strong>
          <p>{result.summary}</p>
        </div>
      )}

      {result.exit_code != null && (
        <p className="muted">
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

      {(result.stdout || result.stderr) && (
        <section className="subpanel">
          <h3>Вывод</h3>
          {result.stdout && (
            <pre className="mono out">{result.stdout}</pre>
          )}
          {result.stderr && (
            <pre className="mono err">{result.stderr}</pre>
          )}
        </section>
      )}

      <details className="raw-details">
        <summary>Полные данные (JSON)</summary>
        <pre className="mono block">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </div>
  )
}

function SystemInfoView({ data }: { data: Record<string, unknown> }) {
  const hostname = String(data.hostname ?? '—')
  const os =
    String(data.os_long ?? data.os ?? '—')
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
    <section className="cards">
      <div className="card">
        <span className="card-label">Hostname</span>
        <strong>{hostname}</strong>
      </div>
      <div className="card wide">
        <span className="card-label">ОС (версия)</span>
        <strong>{os}</strong>
      </div>
      <div className="card">
        <span className="card-label">Ядро</span>
        <strong>{kernel}</strong>
      </div>
      <div className="card">
        <span className="card-label">Архитектура</span>
        <strong>{arch}</strong>
      </div>
      {typeof ramT === 'number' && typeof ramU === 'number' && (
        <div className="card wide">
          <span className="card-label">Память</span>
          <strong>
            {Math.round(ramU / 1024 / 1024)} / {Math.round(ramT / 1024 / 1024)}{' '}
            MiB использовано
          </strong>
        </div>
      )}
      {typeof cpusN === 'number' && (
        <div className="card">
          <span className="card-label">Логических CPU</span>
          <strong>{cpusN}</strong>
        </div>
      )}
      {ips.length > 0 && (
        <div className="card wide">
          <span className="card-label">IP-адреса на интерфейсах</span>
          <p className="mono small">{ips.join(', ')}</p>
        </div>
      )}
      {ifaces.length > 0 && (
        <div className="card wide">
          <span className="card-label">Сетевые интерфейсы</span>
          <table className="compact">
            <thead>
              <tr>
                <th>Имя</th>
                <th>IP</th>
                <th>RX байт</th>
                <th>TX байт</th>
              </tr>
            </thead>
            <tbody>
              {ifaces.map((row, i) => {
                const r = row as Record<string, unknown>
                const ipList = Array.isArray(r.ip_addresses)
                  ? r.ip_addresses.map(String).join(', ')
                  : '—'
                return (
                  <tr key={i}>
                    <td>{String(r.name ?? '')}</td>
                    <td className="mono small">{ipList}</td>
                    <td className="mono">{String(r.received_bytes ?? r.received ?? '')}</td>
                    <td className="mono">{String(r.transmitted_bytes ?? r.transmitted ?? '')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {mounts.length > 0 && (
        <div className="card wide">
          <span className="card-label">Диски (смонтированные)</span>
          <table className="compact">
            <thead>
              <tr>
                <th>Точка</th>
                <th>Всего (ГБ)</th>
                <th>Доступно (ГБ)</th>
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
                    <tr key={i}>
                      <td className="mono small">{mp}</td>
                      <td>{(tb / 1e9).toFixed(1)}</td>
                      <td>{(ab / 1e9).toFixed(1)}</td>
                    </tr>
                  )
                }
                return (
                  <tr key={i}>
                    <td className="mono small">{mp}</td>
                    <td>{String(r.total_gb ?? '')}</td>
                    <td>{String(r.avail_gb ?? '')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function PortCheckView({ data }: { data: Record<string, unknown> }) {
  const results = Array.isArray(data.results) ? data.results : []
  const to = data.timeout_secs
  return (
    <>
      {to != null && (
        <p className="muted small">Таймаут TCP: {String(to)} с</p>
      )}
      <table className="compact">
        <thead>
          <tr>
            <th>Адрес</th>
            <th>TCP</th>
            <th>Время мс</th>
            <th>Ошибка</th>
            <th>DNS/resolved</th>
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
              <tr key={i}>
                <td className="mono small">
                  {String(r.address_tried ?? `${r.host}:${r.port}`)}
                </td>
                <td>
                  <span className={`pill ${open ? 'online' : 'offline'}`}>
                    {open ? 'OK' : 'нет'}
                  </span>
                </td>
                <td className="mono">
                  {r.connect_time_ms != null
                    ? Number(r.connect_time_ms).toFixed(1)
                    : '—'}
                </td>
                <td className="small muted">{String(r.error ?? '—')}</td>
                <td className="mono small">{res}</td>
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
      <div className="card wide">
        <span className="card-label">Hostname</span>
        <strong>{String(data.hostname ?? '')}</strong>
      </div>
    )
  }
  if (scenario === 'uname' || (data.line && scenario !== 'cpu_load')) {
    return (
      <div className="card wide">
        <span className="card-label">Сводка ОС</span>
        <pre className="mono flat">{String(data.line ?? '')}</pre>
      </div>
    )
  }
  if (scenario === 'interfaces_summary' && Array.isArray(data.names)) {
    return (
      <div className="card wide">
        <span className="card-label">Интерфейсы</span>
        <p>{data.names.map(String).join(', ')}</p>
      </div>
    )
  }
  if (scenario === 'memory_disks') {
    return (
      <section className="cards">
        <div className="card">
          <span className="card-label">RAM (MiB)</span>
          <strong>
            {String(data.ram_used_mb ?? '')} / {String(data.ram_total_mb ?? '')}
          </strong>
        </div>
        <div className="card">
          <span className="card-label">Swap (MiB)</span>
          <strong>
            {String(data.swap_used_mb ?? '')} / {String(data.swap_total_mb ?? '')}
          </strong>
        </div>
        {Array.isArray(data.disk_mounts) && (
          <div className="card wide">
            <span className="card-label">Тома</span>
            <table className="compact">
              <tbody>
                {(data.disk_mounts as unknown[]).map((row, i) => {
                  const r = row as Record<string, unknown>
                  return (
                    <tr key={i}>
                      <td>{String(r.mount ?? '')}</td>
                      <td className="mono">
                        {String(r.avail_gb ?? '')} / {String(r.total_gb ?? '')} ГБ
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    )
  }
  if (scenario === 'cpu_load') {
    const g = data.global_usage_percent
    const per = Array.isArray(data.per_cpu) ? data.per_cpu : []
    return (
      <div className="card wide">
        <span className="card-label">Загрузка CPU</span>
        <p>
          <strong>Общая: {String(g ?? '')}%</strong>
        </p>
        <ul className="small muted">
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
      <div className="card wide">
        <span className="card-label">DNS</span>
        <p>
          <code>{String(data.query ?? '')}</code>
        </p>
        <p className="mono small">{addrs.join(', ') || '—'}</p>
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
        <p className="muted small">Таймаут: {String(to)} с</p>
      )}
      <table className="compact">
        <thead>
          <tr>
            <th>Цель</th>
            <th>TCP</th>
            <th>мс</th>
            <th>Ошибка</th>
            <th>Пример DNS</th>
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
              <tr key={i}>
                <td className="mono small">{String(r.target ?? '')}</td>
                <td>
                  <span className={`pill ${ok ? 'online' : 'offline'}`}>
                    {ok ? 'OK' : 'нет'}
                  </span>
                </td>
                <td className="mono">
                  {r.connect_time_ms != null
                    ? Number(r.connect_time_ms).toFixed(1)
                    : '—'}
                </td>
                <td className="small muted">{String(r.error ?? '—')}</td>
                <td className="mono small">{dns}</td>
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
    <section className="bundle-section">
      <div className="callout">
        <strong>Шаблон: {template}</strong>
        <p className="muted small">{desc}</p>
      </div>
      {keys.map((k) => (
        <details key={k} className="subpanel" open={keys.length <= 3}>
          <summary>{k}</summary>
          <pre className="mono block small-json">
            {JSON.stringify(data[k], null, 2)}
          </pre>
        </details>
      ))}
    </section>
  )
}
