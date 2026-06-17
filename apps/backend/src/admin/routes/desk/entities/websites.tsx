import WebsitesPage from "../../websites/page"
import WebsitesCreate from "../../websites/create/page"
import WebsiteDetailPage from "../../websites/[id]/page"
import WebsiteEdit from "../../websites/[id]/@edit/page"
import WebsiteCreatePage from "../../websites/[id]/@create/page"
import WebsiteBlog from "../../websites/[id]/@blog/page"
import WebsiteMetadata from "../../websites/[id]/@metadata/page"
import WebsiteMetadataEdit from "../../websites/[id]/@metadata/edit/page"
import WebsiteAnalytics from "../../websites/[id]/analytics/page"
import WebsiteConsole from "../../websites/[id]/console/page"
import WebsiteLive from "../../websites/[id]/live/page"
import WebsitePageDetail from "../../websites/[id]/pages/[pageId]/page"
import WebsitePageEdit from "../../websites/[id]/pages/[pageId]/@edit/page"
import WebsitePageVisualEditor from "../../websites/[id]/pages/[pageId]/@visual-editor/page"
import WebsitePageSend from "../../websites/[id]/pages/[pageId]/@send/page"
import WebsitePageMetadataEdit from "../../websites/[id]/pages/[pageId]/@metadata/edit/page"
import WebsitePagePublicMetadataEdit from "../../websites/[id]/pages/[pageId]/@public-metadata/edit/page"
import WebsitePageBlockNew from "../../websites/[id]/pages/[pageId]/@blocks/new/page"
import WebsitePageBlockEdit from "../../websites/[id]/pages/[pageId]/@blocks/[blockId]/page"
import type { EntityPanelConfig } from "../EntityPanel"

/**
 * Websites entity wiring. List + create + website detail with its overlays
 * and sub-pages (analytics/console/live + the page editor under
 * pages/:pageId and its overlays). Paths mirror Medusa's @-folder
 * convention without the `@` prefix; any route not listed here falls back
 * to the Desk recovery card.
 */
export const websitesEntityConfig: EntityPanelConfig = {
  initialPath: "/websites",
  routes: [
    {
      path: "/websites",
      element: <WebsitesPage />,
      children: [{ path: "create", element: <WebsitesCreate /> }],
    },
    {
      path: "/websites/:id",
      element: <WebsiteDetailPage />,
      children: [
        { path: "edit", element: <WebsiteEdit /> },
        { path: "create", element: <WebsiteCreatePage /> },
        { path: "blog", element: <WebsiteBlog /> },
        { path: "metadata", element: <WebsiteMetadata /> },
        { path: "metadata/edit", element: <WebsiteMetadataEdit /> },
      ],
    },
    { path: "/websites/:id/analytics", element: <WebsiteAnalytics /> },
    { path: "/websites/:id/console", element: <WebsiteConsole /> },
    { path: "/websites/:id/live", element: <WebsiteLive /> },
    {
      path: "/websites/:id/pages/:pageId",
      element: <WebsitePageDetail />,
      children: [
        { path: "edit", element: <WebsitePageEdit /> },
        { path: "visual-editor", element: <WebsitePageVisualEditor /> },
        { path: "send", element: <WebsitePageSend /> },
        { path: "metadata/edit", element: <WebsitePageMetadataEdit /> },
        { path: "public-metadata/edit", element: <WebsitePagePublicMetadataEdit /> },
        { path: "blocks/new", element: <WebsitePageBlockNew /> },
        { path: "blocks/:blockId", element: <WebsitePageBlockEdit /> },
      ],
    },
  ],
}
