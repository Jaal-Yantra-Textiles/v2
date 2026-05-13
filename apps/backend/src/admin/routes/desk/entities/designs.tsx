import DesignsPage from "../../designs/page"
import DesignsCreatePage from "../../designs/@create/page"
import DesignsPreviewPage from "../../designs/@preview/[id]/page"
import DesignDetailPage from "../../designs/[id]/page"
import DesignEdit from "../../designs/[id]/@edit/page"
import DesignEditColorPalette from "../../designs/[id]/@edit-color-palette/page"
import DesignEditSize from "../../designs/[id]/@edit-size/page"
import DesignRevise from "../../designs/[id]/@revise/page"
import DesignRevisions from "../../designs/[id]/@revisions/page"
import DesignAddNote from "../../designs/[id]/@addnote/page"
import DesignMedia from "../../designs/[id]/@media/page"
import DesignMoodboard from "../../designs/[id]/@moodboard/page"
import DesignPrint from "../../designs/[id]/@print/page"
import DesignLinkPartner from "../../designs/[id]/@linkPartner/page"
import DesignAddComponent from "../../designs/[id]/@add-component/page"
import DesignAddInv from "../../designs/[id]/@addinv/page"
import DesignProductionRun from "../../designs/[id]/@production-run/page"
import DesignViewCanvas from "../../designs/[id]/@view-canvas/page"
import DesignMetadataEdit from "../../designs/[id]/@metadata/edit/page"
import DesignTasksNew from "../../designs/[id]/@tasks/new/page"
import DesignTasksTemplates from "../../designs/[id]/@tasks/templates/page"
import DesignTaskDetail from "../../designs/[id]/@tasks/[taskId]/page"
import DesignInventoryDetail from "../../designs/[id]/@inventory/[inventoryId]/page"
import type { EntityPanelConfig } from "../EntityPanel"

/**
 * Designs entity wiring for the workspace. List + detail + all 17 detail
 * overlays + the 2 list overlays. Paths mirror Medusa's @-folder
 * convention without the `@` prefix (Medusa's file-router strips it).
 */
export const designsEntityConfig: EntityPanelConfig = {
  initialPath: "/designs",
  routes: [
    {
      path: "/designs",
      element: <DesignsPage />,
      children: [
        { path: "create", element: <DesignsCreatePage /> },
        { path: "preview/:id", element: <DesignsPreviewPage /> },
      ],
    },
    {
      path: "/designs/:id",
      element: <DesignDetailPage />,
      children: [
        { path: "edit", element: <DesignEdit /> },
        { path: "edit-color-palette", element: <DesignEditColorPalette /> },
        { path: "edit-size", element: <DesignEditSize /> },
        { path: "revise", element: <DesignRevise /> },
        { path: "revisions", element: <DesignRevisions /> },
        { path: "addnote", element: <DesignAddNote /> },
        { path: "media", element: <DesignMedia /> },
        { path: "moodboard", element: <DesignMoodboard /> },
        { path: "print", element: <DesignPrint /> },
        { path: "linkPartner", element: <DesignLinkPartner /> },
        { path: "add-component", element: <DesignAddComponent /> },
        { path: "addinv", element: <DesignAddInv /> },
        { path: "production-run", element: <DesignProductionRun /> },
        { path: "view-canvas", element: <DesignViewCanvas /> },
        { path: "metadata/edit", element: <DesignMetadataEdit /> },
        { path: "tasks/new", element: <DesignTasksNew /> },
        { path: "tasks/templates", element: <DesignTasksTemplates /> },
        { path: "tasks/:taskId", element: <DesignTaskDetail /> },
        { path: "inventory/:inventoryId", element: <DesignInventoryDetail /> },
      ],
    },
  ],
}
