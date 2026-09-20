import { useParams } from "react-router-dom"

import { GraphWorkspace } from "../../../../components/graph/graph-workspace"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"

/**
 * `/production-runs/:id/graph` — the run spine as the workspace (#2111 S2).
 *
 * The fifth spine, and still the same file with one word changed: no new route
 * on the server, no new hook, no new canvas. It exists because the section on
 * the run page links here, and a card whose expand link lands on nothing is the
 * defect filed as #2114 — a link to a route that was never created reads as a
 * broken page, not as a missing feature.
 */
const ProductionRunGraphWorkspacePage = () => {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <RouteFocusModal.Title asChild>
        <span className="sr-only">Production run graph</span>
      </RouteFocusModal.Title>
      <RouteFocusModal.Description asChild>
        <span className="sr-only">
          The run and its neighbours — what it is waiting on, who it is for, and
          the edges that are expected and missing.
        </span>
      </RouteFocusModal.Description>
      <RouteFocusModal.Body className="flex h-full w-full flex-col overflow-hidden p-0">
        <GraphWorkspace
          spine="production_run"
          id={id!}
          title="Production run graph"
          selfHref={`/production-runs/${id}/graph`}
        />
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export default ProductionRunGraphWorkspacePage
