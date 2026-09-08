import type { ReactNode } from "react"
import { Link, useLocation } from "react-router-dom"

import ProductsAwaitingQueuePage from "../../queues/products-awaiting/page"
import RunsRejectedQueuePage from "../../queues/runs-rejected/page"
import type { EntityPanelConfig } from "../EntityPanel"

/**
 * Queues: cohort boards, as a Desk panel.
 *
 * The point of it being a panel rather than only a page is the workflow it
 * serves — the boards say which designs need a decision, and the answer to
 * each is a design or a product, in another tab, side by side. A board you
 * have to navigate away from to act on is a report.
 *
 * Registered here from the start, unlike the graph itself: the per-record
 * graph shipped as an admin route and reached Desk three PRs later, by which
 * time the design page had already retired the sections it replaced and the
 * capability was missing from the workspace entirely.
 *
 * 🔴 Every route here needs something that links to it. EntityPanel renders
 * `routes[]` but navigates only by path, so a board registered with nothing
 * pointing at it is unreachable — a dead capability that looks, in this
 * config, exactly like a live one. `QueueSwitcher` is that something: the row
 * of links it draws above each board means whichever one the panel opens on,
 * the other is one click away.
 */

/** The boards this panel hosts, in switcher order. */
const QUEUE_BOARDS = [
  { path: "/queues/products-awaiting", label: "Products awaiting creation" },
  { path: "/queues/runs-rejected", label: "Rejected production runs" },
]

/**
 * One board, with the row of links to its sibling above it. The current
 * board's link is marked, so the row says where you are as well as where you
 * can go.
 */
const QueueSwitcher = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation()
  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex items-center gap-2">
        {QUEUE_BOARDS.map((board) => (
          <Link
            key={board.path}
            to={board.path}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              pathname === board.path
                ? "border-ui-border-strong bg-ui-bg-base text-ui-fg-base"
                : "border-transparent bg-transparent text-ui-fg-subtle hover:text-ui-fg-base"
            }`}
          >
            {board.label}
          </Link>
        ))}
      </div>
      {children}
    </div>
  )
}

export const queuesEntityConfig: EntityPanelConfig = {
  initialPath: "/queues/products-awaiting",
  routes: [
    {
      path: "/queues/products-awaiting",
      element: (
        <QueueSwitcher>
          <ProductsAwaitingQueuePage />
        </QueueSwitcher>
      ),
    },
    {
      path: "/queues/runs-rejected",
      element: (
        <QueueSwitcher>
          <RunsRejectedQueuePage />
        </QueueSwitcher>
      ),
    },
  ],
}
