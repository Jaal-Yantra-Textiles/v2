import { useParams } from "react-router-dom"

import { GraphWorkspace } from "../../../../components/graph/graph-workspace"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"

/**
 * `/partners/:id/graph` — the partner spine as the workspace (#1847).
 *
 * The second spine, and the whole point of the registry: this file and the
 * design's are the same file with one word changed. No new route on the
 * server, no new hook, no new canvas — `GraphWorkspace` takes the spine key as
 * a prop and everything downstream of it was already spine-agnostic.
 */
const PartnerGraphWorkspacePage = () => {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <RouteFocusModal.Title asChild>
        <span className="sr-only">Partner graph</span>
      </RouteFocusModal.Title>
      <RouteFocusModal.Description asChild>
        <span className="sr-only">
          The partner and its neighbours, including the edges that are expected
          and missing.
        </span>
      </RouteFocusModal.Description>
      <RouteFocusModal.Body className="flex h-full w-full flex-col overflow-hidden p-0">
        <GraphWorkspace
          spine="partner"
          id={id!}
          title="Partner graph"
          selfHref={`/partners/${id}/graph`}
        />
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export default PartnerGraphWorkspacePage
