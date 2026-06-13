import { clx } from "@medusajs/ui"
import { NavLink } from "react-router-dom"

// Chunk 5 (T3.4, #342): the unified partner orders surface is split into kind
// sub-routes (retail | design | inventory | all), each backed by the SAME
// kind-parameterized table. These NavLinks are the tab strip between them —
// deep-linkable and breadcrumb-aware, unlike a local-state tab control.
//
// `/orders` (index) == retail, so the Retail tab needs `end` to avoid matching
// the design/inventory/all child paths as a prefix.
const TABS: { to: string; label: string; end?: boolean }[] = [
  { to: "/orders/all", label: "All" },
  { to: "/orders", label: "Retail", end: true },
  { to: "/orders/design", label: "Design" },
  { to: "/orders/inventory", label: "Inventory" },
]

export const OrderKindTabs = () => {
  return (
    <nav className="flex items-center gap-1 px-6 pb-3 pt-1">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            clx(
              "txt-compact-small-plus transition-fg rounded-md px-3 py-1.5 outline-none",
              "text-ui-fg-subtle hover:bg-ui-bg-base-hover hover:text-ui-fg-base",
              {
                "bg-ui-bg-base text-ui-fg-base shadow-elevation-card-rest":
                  isActive,
              }
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
