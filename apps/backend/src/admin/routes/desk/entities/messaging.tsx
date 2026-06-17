import MessagingPage from "../../messaging/page"
import MessagingCreate from "../../messaging/create/page"
import ConversationPage from "../../messaging/[conversationId]/page"
import type { EntityPanelConfig } from "../EntityPanel"

/**
 * Messaging entity wiring for the workspace: conversation list + a single
 * conversation view + the new-conversation route.
 */
export const messagingEntityConfig: EntityPanelConfig = {
  initialPath: "/messaging",
  routes: [
    {
      path: "/messaging",
      element: <MessagingPage />,
      children: [{ path: "create", element: <MessagingCreate /> }],
    },
    {
      path: "/messaging/:conversationId",
      element: <ConversationPage />,
    },
  ],
}
