import { describe, expect, it } from "vitest"

import { buildCoreRoutes, type WorkspaceType } from "../main-layout"
import {
  DESIGNER_COMMERCE_ROUTE_IDS,
  getSidebarPreset,
} from "../../../../hooks/api/layout-preferences"

// The route builder only reads `t` for labels; the assertions below key off the
// `to` paths, so a pass-through mock is enough.
const t = ((key: string, fallback?: string) => fallback ?? key) as any

const ordersItemPaths = (workspaceType: WorkspaceType | undefined) => {
  const routes = buildCoreRoutes(workspaceType, t)
  return routes.find((r) => r.to === "/orders")?.items?.map((i) => i.to) ?? []
}

describe("buildCoreRoutes — Quotes nav", () => {
  it("includes Quotes under Orders for the designer workspace", () => {
    expect(ordersItemPaths("designer")).toContain("/orders/quotes")
  })

  it("includes Quotes under Orders for the seller workspace", () => {
    expect(ordersItemPaths("seller")).toContain("/orders/quotes")
  })

  it("includes Quotes under Orders for the manufacturer (default) workspace", () => {
    expect(ordersItemPaths("manufacturer")).toContain("/orders/quotes")
  })

  it("includes Quotes under Orders for the legacy/unknown (default) workspace", () => {
    expect(ordersItemPaths(undefined)).toContain("/orders/quotes")
  })

  it("omits Quotes for the individual workspace, which has no Orders group", () => {
    const routes = buildCoreRoutes("individual", t)
    expect(routes.find((r) => r.to === "/orders")).toBeUndefined()
  })

  it("keeps the Orders group visible for designers so Quotes stays reachable", () => {
    // Quotes lives under /orders. If /orders were in the designer commerce-hide
    // list (or hidden by the designer preset), the entry would be unreachable.
    expect(DESIGNER_COMMERCE_ROUTE_IDS).not.toContain("/orders")
    expect(getSidebarPreset("designer")["/orders"]?.hidden).not.toBe(true)
  })
})
