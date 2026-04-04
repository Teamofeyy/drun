import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { getToken } from '../api'
import { qk } from '../queryKeys'

const RECONNECT_MS = 4000

/**
 * SSE: обновляет кэш агентов/задач/метрик. При обрыве — переподключение.
 */
export function useLiveDashboard(enabled: boolean) {
  const qc = useQueryClient()
  const qcRef = useRef(qc)
  qcRef.current = qc

  useEffect(() => {
    if (!enabled) return
    const token = getToken()
    if (!token) return

    let cancelled = false
    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const invalidate = () => {
      const q = qcRef.current
      q.invalidateQueries({ queryKey: qk.agents })
      q.invalidateQueries({ queryKey: qk.tasks })
      q.invalidateQueries({ queryKey: qk.metrics })
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
  }, [enabled])
}
