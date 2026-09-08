/**
 * Chat history as a route modal over the assistant page.
 *
 * The `@` prefix makes this a CHILD route of /assistant (the `@` is stripped
 * from the URL), so it renders inside the page's <Outlet /> — the chat, its
 * useChat thread and any pending attachments stay mounted underneath.
 */
import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { HistoryListModal } from "../_components/history-modal"

const AssistantHistoryPage = () => (
  <RouteFocusModal>
    <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-8 md:px-8">
      <HistoryListModal />
    </RouteFocusModal.Body>
  </RouteFocusModal>
)

export default AssistantHistoryPage
