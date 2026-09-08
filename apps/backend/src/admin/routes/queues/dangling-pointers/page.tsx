import { GraphWorkspace } from "../../../components/graph/graph-workspace"

/**
 * `/queues/dangling-pointers` — the data-integrity board (#1857).
 *
 * Every `<x>_id` column in the database whose target the graph cannot see,
 * drawn as one canvas: ranked by what is UNEXPLAINED, each node carrying the
 * sweep's own sentence — count, rate, a sample of the offending value, and the
 * written reason where one exists — and, where a fixer job has been written
 * for it, the data-ops run that repairs it.
 *
 * 🔴 It renders `GraphWorkspace` unchanged, like the first cohort board. The
 * board is a queue whose members are `table.column` PAIRS rather than records,
 * which cost a resolver and a registry entry: no route, no hook, no new
 * component. The one thing it did need was an affordance the graph never had —
 * a node that RUNS something rather than linking somewhere. That is the `act`
 * rail, and it is the gap #1856 named and left open.
 */
const DanglingPointersQueuePage = () => (
  <div className="flex h-[calc(100vh-140px)] w-full flex-col overflow-hidden rounded-lg border bg-ui-bg-base">
    <GraphWorkspace
      spine="queue"
      id="dangling-pointers"
      title="Dangling pointers"
      selfHref="/queues/dangling-pointers"
    />
  </div>
)

export default DanglingPointersQueuePage
