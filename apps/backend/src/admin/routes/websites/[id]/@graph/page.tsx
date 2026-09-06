import { useParams } from "react-router-dom"

import { GraphWorkspace } from "../../../../components/graph/graph-workspace"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"

/**
 * `/websites/:id/graph` — the website spine as the workspace (#1855).
 *
 * Third spine, same file as the other two with one word changed.
 */
const WebsiteGraphWorkspacePage = () => {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <RouteFocusModal.Title asChild>
        <span className="sr-only">Website graph</span>
      </RouteFocusModal.Title>
      <RouteFocusModal.Description asChild>
        <span className="sr-only">
          The website and its neighbours, including the edges that are expected
          and missing.
        </span>
      </RouteFocusModal.Description>
      <RouteFocusModal.Body className="flex h-full w-full flex-col overflow-hidden p-0">
        <GraphWorkspace
          spine="website"
          id={id!}
          title="Website graph"
          selfHref={`/websites/${id}/graph`}
        />
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export default WebsiteGraphWorkspacePage
