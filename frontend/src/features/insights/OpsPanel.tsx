import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, downloadExport, isAdmin } from '@/api'
import { qk } from '@/queryKeys'

export function OpsPanel() {
  const qc = useQueryClient()
  const admin = isAdmin()
  const [confirmWipe, setConfirmWipe] = useState('')

  const wipe = useMutation({
    mutationFn: api.clearTaskHistory,
    onSuccess: (data) => {
      toast.success(
        `Удалено строк задач: ${data.deleted_task_rows}, очередей Redis: ${data.redis_queue_keys_cleared}`,
      )
      setConfirmWipe('')
      qc.invalidateQueries({ queryKey: qk.tasks })
      qc.invalidateQueries({ queryKey: qk.metrics })
      qc.invalidateQueries({ queryKey: qk.analyticsDaily })
      qc.invalidateQueries({ queryKey: qk.analyticsRanking })
      qc.invalidateQueries({ queryKey: qk.topology })
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Ошибка')
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Экспорт</CardTitle>
          <CardDescription>
            До 5000 последних задач с именем агента — JSON, CSV или PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              downloadExport('json').catch((e) =>
                toast.error(e instanceof Error ? e.message : 'Ошибка'),
              )
            }
          >
            JSON
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              downloadExport('csv').catch((e) =>
                toast.error(e instanceof Error ? e.message : 'Ошибка'),
              )
            }
          >
            CSV
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              downloadExport('pdf').catch((e) =>
                toast.error(e instanceof Error ? e.message : 'Ошибка'),
              )
            }
          >
            PDF
          </Button>
        </CardContent>
      </Card>

      {admin && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-lg text-destructive">
              Опасная зона
            </CardTitle>
            <CardDescription>
              Стереть всю историю проверок: задачи, результаты, логи и ключи
              очередей Redis (<code className="text-xs">infrahub:q:*</code>).
              Агенты и пользователи остаются. Полный сброс БД/томов — только через
              Docker (см. README).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wipe-confirm">
                Введите <code className="text-xs">DELETE_ALL_TASK_HISTORY</code>
              </Label>
              <Input
                id="wipe-confirm"
                value={confirmWipe}
                onChange={(e) => setConfirmWipe(e.target.value)}
                placeholder="DELETE_ALL_TASK_HISTORY"
                className="font-mono text-sm"
              />
            </div>
            <Button
              type="button"
              variant="destructive"
              disabled={
                confirmWipe !== 'DELETE_ALL_TASK_HISTORY' || wipe.isPending
              }
              onClick={() => wipe.mutate()}
            >
              {wipe.isPending ? 'Удаление…' : 'Стереть историю и очистить очереди'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
