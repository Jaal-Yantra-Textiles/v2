/**
 * The inventory lifecycle tools (#1905) against core's own validators — the
 * inventory sibling of product-tool-field-coverage.
 *
 * `route-validator-field-coverage` resolves each write tool's contract from
 * THIS repo's `middlewares.ts`. These four wrap core routes
 * (`/admin/inventory-items`, its `location-levels`, `/admin/reservations`),
 * and core registers the validators in its own middleware config — so from
 * that spec they can only ever be "unbound, declared as such". This file binds
 * them to the imported validators directly, closing both directions the #1348
 * family cares about: a param the tool never offers is silently stripped, and
 * a param the route would reject is a 400.
 *
 * Every one of these tools today advertises EVERY field its validator accepts
 * — zero deliberate omissions. That is the point of writing it down: the first
 * field someone quietly drops will fail here with its name, not vanish the way
 * `weight` did (#1393).
 */

// Imported, never transcribed — same rule as the product spec: a copy of
// core's field list here would rot the moment core added a field.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const coreInventoryValidators = require("@medusajs/medusa/api/admin/inventory-items/validators")
const {
  AdminCreateInventoryItem,
  AdminCreateInventoryLocationLevel,
  AdminUpdateInventoryLocationLevel,
} = coreInventoryValidators
// eslint-disable-next-line @typescript-eslint/no-var-requires
const coreReservationValidators = require("@medusajs/medusa/api/admin/reservations/validators")
const { AdminCreateReservation } = coreReservationValidators

import { ADMIN_MCP_TOOLS } from "../../../api/admin/mcp/lib/registry"
import type { McpToolDef } from "../types"

/** Keys a zod object validator accepts. */
const acceptedKeys = (schema: any): string[] =>
  Object.keys(schema?.shape ?? schema?._def?.shape?.() ?? {})

const findTool = (tools: readonly McpToolDef[], name: string): McpToolDef => {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`tool "${name}" not found — was it renamed?`)
  return tool
}

/**
 * Fields a tool knowingly does not expose, with the reason.
 *
 * Empty for all four today — kept (and asserted below) so the next omission
 * is a written decision rather than a silent strip.
 */
const DELIBERATELY_OMITTED: Record<string, Record<string, string>> = {}

const CASES: Array<{
  key: string
  tool: McpToolDef
  validator: any
  what: string
}> = [
  {
    key: "admin:create_inventory_item",
    tool: findTool(ADMIN_MCP_TOOLS, "create_inventory_item"),
    validator: AdminCreateInventoryItem,
    what: "core route, core validator",
  },
  {
    key: "admin:set_inventory_level",
    tool: findTool(ADMIN_MCP_TOOLS, "set_inventory_level"),
    validator: AdminCreateInventoryLocationLevel,
    what: "core route, core validator",
  },
  {
    key: "admin:update_inventory_level",
    tool: findTool(ADMIN_MCP_TOOLS, "update_inventory_level"),
    validator: AdminUpdateInventoryLocationLevel,
    what: "core route, core validator",
  },
  {
    key: "admin:create_reservation",
    tool: findTool(ADMIN_MCP_TOOLS, "create_reservation"),
    validator: AdminCreateReservation,
    what: "core route, core validator",
  },
]

describe("inventory MCP tools cover the fields their routes accept", () => {
  describe.each(CASES)("$key", ({ key, tool, validator, what }) => {
    const accepted = acceptedKeys(validator)
    const omitted = DELIBERATELY_OMITTED[key] ?? {}

    it(`sanity: the validator was importable and non-empty (${what})`, () => {
      // A bad import path would make every assertion below pass over an
      // empty set — the test would go green by testing nothing. The level
      // update validator is genuinely a TWO-key contract (stocked_quantity,
      // incoming_quantity), so the floor is 1, not the product spec's 5.
      expect(accepted.length).toBeGreaterThan(1)
    })

    it("advertises every accepted field, or names it as a deliberate omission", () => {
      const advertised = new Set(tool.bodyParams ?? [])
      const unaccounted = accepted.filter(
        (field) => !advertised.has(field) && !(field in omitted)
      )

      expect(unaccounted).toEqual([])
    })

    it("advertises nothing the route would reject", () => {
      // A body param the validator does not accept is a 400 waiting to
      // happen on a .strict() core route.
      const strays = (tool.bodyParams ?? []).filter(
        (field) => !accepted.includes(field)
      )

      expect(strays).toEqual([])
    })

    it("declares every advertised body param in its input schema", () => {
      const props = Object.keys((tool.inputSchema as any)?.properties ?? {})
      const undeclared = (tool.bodyParams ?? []).filter((f) => !props.includes(f))

      expect(undeclared).toEqual([])
    })

    it("has no stale entries in its deliberate-omission list", () => {
      // An omission for a field the validator no longer accepts is a note
      // about a world that stopped existing. Delete it rather than let it rot.
      const stale = Object.keys(omitted).filter((f) => !accepted.includes(f))

      expect(stale).toEqual([])
    })
  })
})
