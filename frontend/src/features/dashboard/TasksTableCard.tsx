import { Link } from 'react-router-dom'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { Task } from '@/api'
import { formatDateTime, taskStatusLabel } from '@/utils/format'
import { cn } from '@/lib/utils'

function statusBadgeClass(status: string) {
  switch (status) {
    case 'done':
      return 'success' as const
    case 'failed':
      return 'destructive' as const
    case 'pending':
    case 'running':
      return 'warning' as const
    default:
      return 'secondary' as const
  }
}

export function TasksTableCard({
  tasks,
  loading,
}: {
  tasks: Task[]
  loading: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Задачи</CardTitle>
        <CardDescription>История и статусы постановки в очередь.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Создана</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Повторы</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(t.created_at)}
                  </TableCell>
                  <TableCell>
                    <code
                      className={cn(
                        'rounded bg-muted px-1.5 py-0.5 font-mono text-xs',
                      )}
                    >
                      {t.kind}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeClass(t.status)}>
                      {taskStatusLabel(t.status)}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="text-sm text-muted-foreground"
                    title="retries_used / max_retries"
                  >
                    {t.retries_used ?? 0}/{t.max_retries ?? 0}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/app/tasks/${t.id}`}>Открыть</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
