import { useParams } from "react-router-dom"

import { LinkDesignPartnerForm } from "../../../../components/forms/link-design-partner/link-design-partner-form"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"

/**
 * The SHELL for the partner picker — the form no longer opens a modal itself,
 * so it can also be rendered from the design graph.
 */
const LinkDesignPartnerPage = () => {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <LinkDesignPartnerForm designId={id!} />
    </RouteFocusModal>
  )
}

export default LinkDesignPartnerPage
