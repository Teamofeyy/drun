import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const TEMPLATES = [
  'node_baseline',
  'network_context',
  'internal_services_check',
] as const

type Props = {
  labels: Record<string, string>
  disabled: boolean
  pending: boolean
  onRun: (template: string) => void
}

export function TemplatesCard({
  labels,
  disabled,
  pending,
  onRun,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Шаблоны проверок</CardTitle>
        <CardDescription>
          Одна задача выполняет набор шагов из whitelist в бинарнике агента.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {TEMPLATES.map((t) => (
          <Button
            key={t}
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || pending}
            title={t}
            onClick={() => onRun(t)}
          >
            {labels[t] ?? t}
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}
