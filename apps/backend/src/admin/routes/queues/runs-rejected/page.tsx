import { GraphWorkspace } from "../../../components/graph/graph-workspace"

/**
 * `/queues/runs-rejected` — the second cohort board.
 *
 * A full page rather than a `RouteFocusModal`, unlike the per-record graph
 * workspaces: those are opened FROM a record and close back onto it, while this
 * is not about any one record and has nowhere to close back to. It is a place
 * you go and stay.
 *
 * 🔴 It renders `GraphWorkspace` unchanged. The queue is registered as a spine
 * whose `id` is the queue's NAME, so `useEntityGraph("queue", "runs-
 * rejected")` hits the route that already exists and the canvas, viewport,
 * inspector and member drawer all work as they are. The cohort board cost a
 * resolver and a registry entry — no route, no hook, no new component — which
 * is the claim the spine registry has been making since #1847, now tested from
 * a direction it was not designed for.
 */
const RunsRejectedQueuePage = () => (
  <div className="flex h-[calc(100vh-140px)] w-full flex-col overflow-hidden rounded-lg border bg-ui-bg-base">
    <GraphWorkspace
      spine="queue"
      id="runs-rejected"
      title="Rejected production runs"
      selfHref="/queues/runs-rejected"
    />
  </div>
)

export default RunsRejectedQueuePage
