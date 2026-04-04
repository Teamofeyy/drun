import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  defaultPayloadTextForKind,
  type TaskKind,
} from '@/features/taskComposer/presets'

type State = {
  selectedAgentId: string | null
  kind: TaskKind
  payloadText: string
  maxRetries: number
}

type Actions = {
  setSelectedAgentId: (id: string | null) => void
  setKind: (k: TaskKind) => void
  setPayloadText: (t: string) => void
  setMaxRetries: (n: number) => void
  /** Смена типа проверки с типовым JSON payload */
  applyKindPreset: (k: TaskKind) => void
}

const initial: State = {
  selectedAgentId: null,
  kind: 'system_info',
  payloadText: '{}',
  maxRetries: 2,
}

export const useTaskComposerStore = create<State & Actions>()(
  persist(
    (set) => ({
      ...initial,
      setSelectedAgentId: (id) => set({ selectedAgentId: id }),
      setKind: (k) => set({ kind: k }),
      setPayloadText: (t) => set({ payloadText: t }),
      setMaxRetries: (n) => set({ maxRetries: n }),
      applyKindPreset: (k) =>
        set({
          kind: k,
          payloadText: defaultPayloadTextForKind(k),
        }),
    }),
    {
      name: 'infrahub-task-composer',
      partialize: (s) => ({
        selectedAgentId: s.selectedAgentId,
        kind: s.kind,
        payloadText: s.payloadText,
        maxRetries: s.maxRetries,
      }),
    },
  ),
)
