import { useParams } from "react-router-dom"

import { GraphWorkspace } from "../../../../components/graph/graph-workspace"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"

/**
 * `/designs/:id/graph` — the design spine as the workspace (#1847 step 2).
 *
 * A `RouteFocusModal` rather than a page: the graph is opened FROM a design
 * and closes back onto it, and the focus modal is what gives it the whole
 * screen. The card on the design page stays for now — step 3 removes the
 * other sections only once edit and create genuinely live in here.
 */
const DesignGraphWorkspacePage = () => {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <RouteFocusModal.Title asChild>
        <span className="sr-only">Design graph</span>
      </RouteFocusModal.Title>
      <RouteFocusModal.Description asChild>
        <span className="sr-only">
          The design and its neighbours, including the edges that are expected
          and missing.
        </span>
      </RouteFocusModal.Description>
      <RouteFocusModal.Body className="flex h-full w-full flex-col overflow-hidden p-0">
        <GraphWorkspace
          spine="design"
          id={id!}
          title="Design graph"
          selfHref={`/designs/${id}/graph`}
        />
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export default DesignGraphWorkspacePage
