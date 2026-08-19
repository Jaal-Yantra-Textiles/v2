/**
 * The production-spec tools on BOTH assistant surfaces (#1346).
 *
 * These assert the three things that fail silently rather than loudly:
 *  - a tool whose path names a route that does not exist (the dispatcher is a
 *    loopback proxy, so a typo is a 404 at call time, never at build time);
 *  - a tool that is classified but that no ordinary ask can reach — the
 *    "classified ≠ reachable" failure that hid four live bugs in #1315;
 *  - a body key the validator accepts but the dispatcher does not forward, so
 *    the write silently drops half the spec.
 */
import fs from "fs"
import path from "path"
import { ADMIN_MCP_TOOLS } from "../../../api/admin/mcp/lib/registry"
import { PARTNER_MCP_TOOLS } from "../../../api/partners/mcp/lib/registry"
import { selectAdminToolSlice } from "../../../api/admin/mcp/lib/tool-slice"
import { selectPartnerToolSlice } from "../../../api/partners/mcp/lib/tool-slice"
import { mcpToolTier } from "../../../lib/mcp-core/tiers"
import { PartnerProductSpecReq } from "../../../api/partners/products/validators"
import { PRODUCT_SPEC_BODY_PARAMS } from "../tool-schema"
import { SUPPORTED_WEAVES } from "../weaving-techniques"

const SPEC_TOOLS = ["get_spec_catalog", "get_product_spec", "set_product_spec"]

const SURFACES = [
  // `confirms` is the surfaces' one deliberate difference: an admin writes ANY
  // maker's spec, so the admin registry's rule that every write is confirm-
  // gated applies; the partner tool can only ever touch the caller's own
  // product, which is why `set_artisan_detail` next to it is not gated either.
  { surface: "admin", tools: ADMIN_MCP_TOOLS, prefix: "/admin", confirms: true },
  { surface: "partner", tools: PARTNER_MCP_TOOLS, prefix: "/partners", confirms: false },
] as const

const find = (tools: readonly any[], name: string) => {
  const matches = tools.filter((t) => t.name === name)
  if (matches.length !== 1) {
    throw new Error(`${name} is registered ${matches.length} times, expected 1`)
  }
  return matches[0]
}

/** `/admin/products/:id/spec` -> `src/api/admin/products/[id]/spec/route.ts`. */
const routeFile = (toolPath: string) =>
  path.join(
    __dirname,
    "../../../api",
    toolPath
      .replace(/^\//, "")
      .split("/")
      .map((seg) => (seg.startsWith(":") ? `[${seg.slice(1)}]` : seg))
      .join("/"),
    "route.ts"
  )

describe("production-spec MCP tools", () => {
  describe.each(SURFACES)("$surface surface", ({ tools, prefix, confirms }) => {
    it("registers all three spec tools exactly once", () => {
      for (const name of SPEC_TOOLS) {
        expect([name, find(tools, name).name]).toEqual([name, name])
      }
    })

    it("points every tool at a route file that exists", () => {
      // The dispatcher forwards to the real route; a path that names nothing is
      // a 404 the model reports as "I can't do that", with nothing in the build
      // or the type-checker to catch it first.
      const missing = SPEC_TOOLS.map((name) => find(tools, name))
        .filter((def) => !fs.existsSync(routeFile(def.path)))
        .map((def) => def.path)
      expect(missing).toEqual([])
    })

    it("serves the tools from its own surface's routes", () => {
      for (const name of SPEC_TOOLS) {
        expect(find(tools, name).path.startsWith(`${prefix}/`)).toBe(true)
      }
    })

    it("keeps the write on the `write` rung, whatever its confirm gate", () => {
      // The confirm gate and the permission rung are separate questions (see
      // lib/mcp-core/tiers). A spec is reversible, costs nothing and touches
      // nobody outside the platform, so a write-scoped credential must reach it
      // on BOTH surfaces even where the UI still asks a human first.
      const def = find(tools, "set_product_spec")
      expect([def.write === true, mcpToolTier(def)]).toEqual([true, "write"])
    })

    it("gates the write behind confirm exactly where the surface demands it", () => {
      expect(find(tools, "set_product_spec").sensitive === true).toBe(confirms)
    })

    it("reads are not writes", () => {
      for (const name of ["get_spec_catalog", "get_product_spec"]) {
        const def = find(tools, name)
        expect([name, def.method, def.write === true]).toEqual([name, "GET", false])
      }
    })

    it("forwards every body key the validator accepts", () => {
      // A key the validator takes but `bodyParams` omits is dropped by the
      // dispatcher: the route returns 200 and the partner's palette is simply
      // not there.
      const accepted = Object.keys((PartnerProductSpecReq as any).shape).sort()
      const forwarded = [...find(tools, "set_product_spec").bodyParams].sort()
      expect(forwarded).toEqual(accepted)
      expect([...PRODUCT_SPEC_BODY_PARAMS].sort()).toEqual(accepted)
    })

    it("offers exactly the weave slugs the workflow will accept", () => {
      // Derived from the catalog rather than typed out, so a technique added or
      // removed cannot leave the model offering a value the write rejects.
      const def = find(tools, "set_product_spec")
      expect(def.inputSchema.properties.weave_technique.enum).toEqual([
        ...SUPPORTED_WEAVES,
      ])
    })
  })

  describe("reachability from an ordinary ask", () => {
    const ASKS = [
      "record the weave and colour palette for this product",
      "what production spec does prod_123 have?",
      "set the gsm and picks per inch on this shawl",
      "is this product accepting custom orders?",
    ]

    it.each(ASKS)("an admin asking %j gets every spec tool", (ask) => {
      const slice = selectAdminToolSlice(ask, ADMIN_MCP_TOOLS as any)
      const unreachable = SPEC_TOOLS.filter((n) => !slice.names.includes(n))
      expect({ ask, unreachable }).toEqual({ ask, unreachable: [] })
    })

    it.each(ASKS)("a partner asking %j gets every spec tool", (ask) => {
      const slice = selectPartnerToolSlice(ask, PARTNER_MCP_TOOLS as any)
      const unreachable = SPEC_TOOLS.filter((n) => !slice.names.includes(n))
      expect({ ask, unreachable }).toEqual({ ask, unreachable: [] })
    })
  })

  it("names the tools identically on both surfaces", () => {
    // The two assistants are told about the same capability; a partner asking
    // an admin "which tool did you use?" should not get a different word.
    for (const name of SPEC_TOOLS) {
      const admin = find(ADMIN_MCP_TOOLS, name)
      const partner = find(PARTNER_MCP_TOOLS, name)
      expect([name, admin.method]).toEqual([name, partner.method])
    }
  })
})

/**
 * #1348's lesson, applied to the option groups: an MCP row is a CONTRACT with
 * the route validator behind it. Where the two disagree, the caller finds out
 * by 400 — and the message is a zod field path.
 *
 * The live report that prompted this: the admin spec editor answered a partner
 * with `Value for field 'options, 0, values, 0, label' too small, expected at
 * least: '1'`. The form was fixed to stop sending blank rows, but a model
 * calling `set_product_spec` could send exactly the same payload, and the tool
 * schema said nothing about it — `label` was merely `required`, with no
 * minLength. These cases pin the schema to the validator's actual limits.
 */
describe("set_product_spec options schema mirrors the route validator", () => {
  const { PRODUCT_SPEC_TOOL_SCHEMA_PROPS = null } = require("../tool-schema") as any
  const props =
    PRODUCT_SPEC_TOOL_SCHEMA_PROPS ?? require("../tool-schema").productSpecSchemaProps()
  const options = props.options
  const group = options.items
  const value = group.properties.values.items

  it("bounds the option list the way the validator does (max 12)", () => {
    expect(options.maxItems).toBe(12)
  })

  it("requires a non-empty value label — z.string().trim().min(1)", () => {
    expect(value.properties.label.minLength).toBe(1)
    expect(value.properties.label.maxLength).toBe(160)
    expect(value.required).toContain("label")
  })

  it("requires a non-empty option key — z.string().trim().min(1).max(60)", () => {
    expect(group.properties.key.minLength).toBe(1)
    expect(group.properties.key.maxLength).toBe(60)
    expect(group.required).toContain("key")
  })

  it("states that a group needs at least one value, and at most 40", () => {
    expect(group.properties.values.minItems).toBe(1)
    expect(group.properties.values.maxItems).toBe(40)
  })

  it("caps the group label at the validator's 120", () => {
    expect(group.properties.label.maxLength).toBe(120)
  })
})
