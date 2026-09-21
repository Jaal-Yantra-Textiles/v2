import { GraphWorkspace } from "../../../components/graph/graph-workspace"

/**
 * `/queues/runs-awaiting-dispatch` — the third cohort board (#2202).
 *
 * The board this feature was built for. A run held on its supply and a run
 * whose supply arrived with nobody told to cut it are the same row in every
 * status-based view: `approved`, `idle`. Here they are two states, worded
 * differently on purpose — one is waiting correctly, the other is stuck.
 *
 * 🔴 `GraphWorkspace` unchanged again, and that is now the third time. Resolver
 * plus registry entry, no route, no hook, no component.
 */
const RunsAwaitingDispatchQueuePage = () => (
  <div className="flex h-[calc(100vh-140px)] w-full flex-col overflow-hidden rounded-lg border bg-ui-bg-base">
    <GraphWorkspace
      spine="queue"
      id="runs-awaiting-dispatch"
      title="Runs awaiting dispatch"
      selfHref="/queues/runs-awaiting-dispatch"
    />
  </div>
)

export default RunsAwaitingDispatchQueuePage
