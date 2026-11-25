import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"

import { CreateBriefForm } from "./create-brief-form"

/** New brief (#2608): a route focus modal with steps, like starting a quote. */
const CreateBriefPage = () => (
  <RouteFocusModal prev="/quotes/briefs">
    <CreateBriefForm />
  </RouteFocusModal>
)

export const handle = { breadcrumb: () => "New brief" }

export default CreateBriefPage
