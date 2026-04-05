import { MachineDiffPanel } from '@/features/insights/MachineDiffPanel'
import { TopologyPanel } from '@/features/insights/TopologyPanel'

export function TopologyPage() {
  return (
    <div className="flex flex-col gap-6">
      <TopologyPanel />
      <MachineDiffPanel />
    </div>
  )
}
