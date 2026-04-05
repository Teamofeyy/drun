import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { api } from '@/api'
import { qk } from '@/queryKeys'

export function AnalyticsPanel() {
  const dailyQ = useQuery({
    queryKey: qk.analyticsDaily,
    queryFn: () => api.analyticsDaily(14),
    refetchInterval: 60_000,
  })

  const rankQ = useQuery({
    queryKey: qk.analyticsRanking,
    queryFn: () => api.analyticsRanking(7),
    refetchInterval: 60_000,
  })

  const groupsQ = useQuery({
    queryKey: qk.analyticsGroups,
    queryFn: api.analyticsGroups,
    refetchInterval: 120_000,
  })

  const byDay = useMemo(() => {
    const series = dailyQ.data?.series ?? []
    const m = new Map<
      string,
      { runs: number; errors: number; sum: number; cnt: number }
    >()
    for (const r of series) {
      const cur = m.get(r.day) ?? { runs: 0, errors: 0, sum: 0, cnt: 0 }
      cur.runs += r.runs
      cur.errors += r.errors
      if (r.avg_duration_seconds != null) {
        cur.sum += r.avg_duration_seconds
        cur.cnt += 1
      }
      m.set(r.day, cur)
    }
    return [...m.entries()]
      .map(([day, v]) => ({
        day,
        runs: v.runs,
        errors: v.errors,
        avg_sec: v.cnt ? Math.round((v.sum / v.cnt) * 10) / 10 : null,
      }))
      .sort((a, b) => a.day.localeCompare(b.day))
  }, [dailyQ.data])

  const topRank = useMemo(
    () => (rankQ.data?.ranking ?? []).slice(0, 12),
    [rankQ.data],
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Активность по дням</CardTitle>
            <CardDescription>
              Сумма запусков и ошибок по всем агентам (окно из API, до 14 дней).
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[320px]">
            {dailyQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка…</p>
            ) : byDay.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={byDay}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="runs"
                    name="Запуски"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="errors"
                    name="Ошибки"
                    stroke="hsl(var(--destructive))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Рейтинг агентов</CardTitle>
            <CardDescription>
              Комбинированный балл: стабильность (успешные завершения) и скорость
              (обратная к среднему времени задачи).
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[320px]">
            {rankQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка…</p>
            ) : topRank.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет завершённых задач.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topRank}
                  layout="vertical"
                  margin={{ left: 8, right: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" domain={[0, 1]} tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                    }}
                  />
                  <Bar
                    dataKey="combined_score"
                    name="Балл"
                    fill="hsl(var(--primary))"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Группы агентов</CardTitle>
          <CardDescription>
            Распределение по площадке (site), сегменту и тегу роли узла.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {groupsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {(
                [
                  ['Площадки', groupsQ.data?.by_site],
                  ['Сегменты', groupsQ.data?.by_segment],
                  ['Роли узла', groupsQ.data?.by_role_tag],
                ] as const
              ).map(([title, map]) => (
                <div
                  key={title}
                  className="rounded-lg border border-border bg-muted/20 p-4"
                >
                  <p className="mb-2 text-sm font-medium">{title}</p>
                  <ul className="max-h-48 space-y-1 overflow-auto text-sm text-muted-foreground">
                    {map &&
                      Object.entries(map).map(([k, v]) => (
                        <li key={k} className="flex justify-between gap-2">
                          <span className="truncate">{k}</span>
                          <span className="shrink-0 tabular-nums text-foreground">
                            {v}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
