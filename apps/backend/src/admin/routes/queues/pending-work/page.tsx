import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ListCheckbox } from "@medusajs/icons"

import { GraphWorkspace } from "../../../components/graph/graph-workspace"

/**
 * `/queues/pending-work` — everything the business is waiting on, on one
 * board (#2625 S1).
 *
 * The other boards each answer one question ("which products are missing?").
 * This one answers "what is waiting on us, or on someone we are waiting for?"
 * — one box per kind of waiting work, with its count, and the drawer lists the
 * records. Same queue spine, same canvas: it is a resolver and a registry
 * line, not a new view.
 *
 * `rank: 0` puts it first among the custom admin routes — the founder asked
 * for it "on the top over everything".
 */
const PendingWorkPage = () => (
  <div className="flex h-[calc(100vh-140px)] w-full flex-col overflow-hidden rounded-lg border bg-ui-bg-base">
    <GraphWorkspace
      spine="queue"
      id="pending-work"
      title="Pending work"
      selfHref="/queues/pending-work"
    />
  </div>
)

export const config = defineRouteConfig({
  label: "Pending work",
  icon: ListCheckbox,
  rank: 0,
})

export default PendingWorkPage
