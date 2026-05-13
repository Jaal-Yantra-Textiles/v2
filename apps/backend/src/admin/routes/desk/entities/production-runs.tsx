import ProductionRunsPage from "../../production-runs/page"
import ProductionRunDetailPage from "../../production-runs/[id]/page"
import ProductionRunEdit from "../../production-runs/[id]/@edit/page"
import ProductionRunDispatch from "../../production-runs/[id]/@dispatch/page"
import ProductionRunCost from "../../production-runs/[id]/@cost/page"
import ProductionRunApprove from "../../production-runs/[id]/@approve/page"
import ProductionRunTaskDetail from "../../production-runs/[id]/@tasks/[taskId]/page"
import type { EntityPanelConfig } from "../EntityPanel"

export const productionRunsEntityConfig: EntityPanelConfig = {
  initialPath: "/production-runs",
  routes: [
    {
      path: "/production-runs",
      element: <ProductionRunsPage />,
    },
    {
      path: "/production-runs/:id",
      element: <ProductionRunDetailPage />,
      children: [
        { path: "edit", element: <ProductionRunEdit /> },
        { path: "dispatch", element: <ProductionRunDispatch /> },
        { path: "cost", element: <ProductionRunCost /> },
        { path: "approve", element: <ProductionRunApprove /> },
        { path: "tasks/:taskId", element: <ProductionRunTaskDetail /> },
      ],
    },
  ],
}
