import { useParams } from "react-router-dom"

import { AddDesignComponentForm } from "../../../../components/creates/create-design-component"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"

/** The SHELL. The form itself lives in `components/creates` so the design
 *  graph can render it too. */
export default function AddComponentPage() {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <AddDesignComponentForm designId={id!} />
    </RouteFocusModal>
  )
}
