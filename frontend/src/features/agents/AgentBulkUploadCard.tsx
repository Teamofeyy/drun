import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import { api, type Agent } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { qk } from '@/queryKeys'

type Props = {
  agents: Agent[]
  selectedIds: string[]
  readOnly: boolean
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export function AgentBulkUploadCard({ agents, selectedIds, readOnly }: Props) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [destinationPath, setDestinationPath] = useState('')
  const [overwrite, setOverwrite] = useState(true)
  const [createParents, setCreateParents] = useState(true)

  const selectedAgents = agents.filter((agent) => selectedIds.includes(agent.id))

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Выберите файл')
      if (selectedAgents.length === 0) throw new Error('Выберите хотя бы один агент')
      if (!destinationPath.trim()) throw new Error('Укажите путь назначения')

      const buffer = await file.arrayBuffer()
      const contentBase64 = bytesToBase64(buffer)
      const payload = {
        filename: file.name,
        destination_path: destinationPath.trim(),
        overwrite,
        create_parents: createParents,
        content_base64: contentBase64,
      }

      const results = await Promise.allSettled(
        selectedAgents.map((agent) => api.createTask(agent.id, 'file_upload', payload, 1)),
      )

      const failed = results.filter((result) => result.status === 'rejected')
      if (failed.length > 0) {
        const first = failed[0]
        const message =
          first.status === 'rejected' && first.reason instanceof Error
            ? first.reason.message
            : 'Ошибка постановки задачи'
        throw new Error(`Не удалось отправить на ${failed.length} агент(ов): ${message}`)
      }

      return results.length
    },
    onSuccess: (count) => {
      toast.success(`Файл поставлен в очередь на ${count} агент(ов)`)
      qc.invalidateQueries({ queryKey: qk.tasks })
      qc.invalidateQueries({ queryKey: qk.metrics })
      qc.invalidateQueries({ queryKey: qk.topology })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Не удалось отправить файл')
    },
  })

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Bulk File Delivery</CardTitle>
        <CardDescription>
          Доставка файла на выбранные агенты без shell. Агент только записывает байты по указанному пути.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const next = event.target.files?.[0] ?? null
            setFile(next)
            if (next && !destinationPath.trim()) {
              setDestinationPath(next.name)
            }
          }}
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <Label>Файл</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={readOnly}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-4" />
                Выбрать файл
              </Button>
              <div className="min-w-0 self-center text-sm text-muted-foreground">
                {file ? `${file.name} · ${file.size} bytes` : 'Файл не выбран'}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="destination-path">Путь назначения на агенте</Label>
            <Input
              id="destination-path"
              value={destinationPath}
              disabled={readOnly}
              onChange={(event) => setDestinationPath(event.target.value)}
              placeholder='например C:\Temp\payload.bin или /tmp/payload.bin'
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              checked={overwrite}
              disabled={readOnly}
              onChange={(event) => setOverwrite(event.target.checked)}
            />
            overwrite existing file
          </label>
          <label className="flex items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              checked={createParents}
              disabled={readOnly}
              onChange={(event) => setCreateParents(event.target.checked)}
            />
            create missing parent directories
          </label>
        </div>

        <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          Выбрано агентов: <strong className="text-foreground">{selectedAgents.length}</strong>
          {selectedAgents.length > 0 ? (
            <span> · {selectedAgents.map((agent) => agent.name).join(', ')}</span>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            disabled={readOnly || upload.isPending || !file || selectedAgents.length === 0}
            onClick={() => upload.mutate()}
          >
            Отправить файл
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
