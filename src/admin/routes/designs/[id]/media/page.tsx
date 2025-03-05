import { useParams } from "react-router-dom"

import { useDesign } from "../../../../hooks/api/designs"
import { DesignMediaView } from "./components/design-media-view"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"

export const DesignMedia = () => {
  const { id } = useParams()

  const { design, isLoading, isError, error } = useDesign(id!)

  const ready = !isLoading && design

  if (isError) {
    throw error
  }

  return (
    <RouteFocusModal>
      <RouteFocusModal.Title asChild>
        <span className="sr-only">Design Media</span>
      </RouteFocusModal.Title>
      <RouteFocusModal.Description asChild>
        <span className="sr-only">Edit design media files</span>
      </RouteFocusModal.Description>
      {ready && <DesignMediaView design={design} />}
    </RouteFocusModal>
  )
}

export default DesignMedia
