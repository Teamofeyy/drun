import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getToken } from '../api'
import { qk } from '../queryKeys'

const RECONNECT_MS = 4000

/**
 * SSE: обновляет кэш агентов/задач/метрик. При обрыве — переподключение.
 */
export function useLiveDashboard(enabled: boolean) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!enabled) return
    const token = getToken()
    if (!token) return

    let cancelled = false
    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const invalidate = () => {
      qc.invalidateQueries({ queryKey: qk.agents })
      qc.invalidateQueries({ queryKey: qk.tasks })
      qc.invalidateQueries({ queryKey: qk.metrics })
    }

    const connect = () => {
      if (cancelled) return
      es?.close()
      const url = `/api/v1/stream/dashboard?token=${encodeURIComponent(token)}`
      es = new EventSource(url)
      es.onmessage = () => invalidate()
      es.onerror = () => {
        es?.close()
        es = null
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, RECONNECT_MS)
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      clearTimeout(reconnectTimer)
      es?.close()
      es = null
    }
  }, [enabled, qc])
}
