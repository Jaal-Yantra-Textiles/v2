import DanglingPointersQueuePage from "../../queues/dangling-pointers/page"
import ProductsAwaitingQueuePage from "../../queues/products-awaiting/page"
import type { EntityPanelConfig } from "../EntityPanel"

/**
 * Queues: cohort boards, as a Desk panel.
 *
 * The point of it being a panel rather than only a page is the workflow it
 * serves — the board says which designs are waiting on a listing, and the
 * answer to each is a design or a product, in another tab, side by side. A
 * board you have to navigate away from to act on is a report.
 *
 * Registered here from the start, unlike the graph itself: the per-record
 * graph shipped as an admin route and reached Desk three PRs later, by which
 * time the design page had already retired the sections it replaced and the
 * capability was missing from the workspace entirely.
 */
export const queuesEntityConfig: EntityPanelConfig = {
  initialPath: "/queues/products-awaiting",
  routes: [
    {
      path: "/queues/products-awaiting",
      element: <ProductsAwaitingQueuePage />,
    },
    {
      path: "/queues/dangling-pointers",
      element: <DanglingPointersQueuePage />,
    },
  ],
}
