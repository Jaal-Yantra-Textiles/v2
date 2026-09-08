/**
 * Media picker as a route modal over the assistant page.
 *
 * The `@` prefix makes this a CHILD route of /assistant (the `@` is stripped
 * from the URL), so it renders inside the page's <Outlet /> — the chat stays
 * mounted underneath, and the picker adds its selection straight into the
 * composer's pending attachments through the shared page context.
 */
import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { MediaPickerModal } from "../_components/media-picker"

const AssistantMediaPage = () => (
  <RouteFocusModal>
    <MediaPickerModal />
  </RouteFocusModal>
)

export default AssistantMediaPage
