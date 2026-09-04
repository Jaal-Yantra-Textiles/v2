import { RouteFocusModal } from "../../../components/modal/route-focus-modal"

import { CreateDraftForm } from "./create-draft-form"

/**
 * Starting a quote opens a DRAFT (#1446).
 *
 * This used to be a four-step wizard that held every answer in the browser and
 * created a fully priced quote in one POST at the very end. That is not the
 * shape of the draft-order rail it is modelled on: there, a small modal
 * captures only what makes the row, saves it, and everything else is edited on
 * the draft afterwards.
 *
 * 🔑 The hook lives in the CHILD. `useRouteModal` reads a context that
 * `RouteFocusModal` itself provides, so a component that renders the modal
 * cannot also call the hook — that is #1352, and it throws at render.
 */
const StartQuotePage = () => (
  <RouteFocusModal prev="/quotes">
    <CreateDraftForm />
  </RouteFocusModal>
)

export const handle = {
  breadcrumb: () => "Start",
}

export default StartQuotePage
