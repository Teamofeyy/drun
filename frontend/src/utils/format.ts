export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(d)
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'никогда'
  const d = new Date(iso)
  const t = d.getTime()
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec} с назад`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} ч назад`
  return formatDateTime(iso)
}

export function taskStatusLabel(s: string): string {
  const map: Record<string, string> = {
    pending: 'В очереди',
    running: 'Выполняется',
    done: 'Готово',
    failed: 'Ошибка',
  }
  return map[s] ?? s
}

export function agentStatusLabel(s: string): string {
  const map: Record<string, string> = {
    online: 'Онлайн',
    busy: 'Занят',
    offline: 'Оффлайн',
  }
  return map[s] ?? s
}
