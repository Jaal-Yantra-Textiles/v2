import MediasPage from "../../medias/page"
import MediasUpload from "../../medias/@upload/page"
import MediasCreate from "../../medias/@create/page"
import MediaDetailPage from "../../medias/[id]/page"
import MediaEdit from "../../medias/[id]/@edit/page"
import MediaMedia from "../../medias/[id]/@media/page"
import type { EntityPanelConfig } from "../EntityPanel"

export const mediasEntityConfig: EntityPanelConfig = {
  initialPath: "/medias",
  routes: [
    {
      path: "/medias",
      element: <MediasPage />,
      children: [
        { path: "upload", element: <MediasUpload /> },
        { path: "create", element: <MediasCreate /> },
      ],
    },
    {
      path: "/medias/:id",
      element: <MediaDetailPage />,
      children: [
        { path: "edit", element: <MediaEdit /> },
        { path: "media", element: <MediaMedia /> },
      ],
    },
  ],
}
