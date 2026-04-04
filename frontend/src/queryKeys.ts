export const qk = {
  agents: ['agents'] as const,
  tasks: ['tasks'] as const,
  metrics: ['metrics', 'summary'] as const,
  task: (id: string) => ['task', id] as const,
  taskResult: (id: string) => ['taskResult', id] as const,
  taskLogs: (id: string) => ['taskLogs', id] as const,
}
