/**
 * `defaultQuery` — query params a tool always sends (#2023).
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * Core's default field set for `/admin/stock-locations` omits
 * `fulfillment_providers`. So `set_location_fulfillment_providers` — a tool
 * whose entire job is changing those links — would answer with a body that
 * cannot show whether the link took, unless the caller happened to pass
 * `fields`. Leaving the read-back to the model's discretion is how a write goes
 * unverified, so the tool declares it and the dispatcher always sends it.
 *
 * The rule is one-directional: it FILLS a gap, never pins a value. A caller who
 * asks for different fields must win, or the default becomes a ceiling.
 */
import { dispatchMcpTool } from "../dispatch"
import type { McpContext, McpToolDef } from "../types"
import { ADMIN_MCP_TOOLS } from "../../../api/admin/mcp/lib/registry"

const ctx = { baseUrl: "http://localhost:9000", surface: "admin" } as McpContext

/** dry_run returns the planned request without touching a route. */
const planOf = async (tools: McpToolDef[], name: string, args: Record<string, unknown> = {}) => {
  const r: any = await dispatchMcpTool(ctx, tools, name, { ...args, dry_run: true })
  expect(r.ok).toBe(true)
  return r.plan
}

const READ: McpToolDef = {
  name: "read_thing",
  description: "x",
  method: "GET",
  path: "/admin/things",
  queryParams: ["limit", "fields"],
  defaultQuery: { fields: "+a.b", order: "-created_at" },
  inputSchema: { type: "object", properties: {} },
}

const NO_DEFAULT: McpToolDef = {
  name: "plain_thing",
  description: "x",
  method: "GET",
  path: "/admin/things",
  queryParams: ["limit"],
  inputSchema: { type: "object", properties: {} },
}

describe("defaultQuery", () => {
  it("is sent when the caller asks for nothing", async () => {
    const plan = await planOf([READ], "read_thing")
    expect(plan.query).toEqual({ fields: "+a.b", order: "-created_at" })
  })

  it("merges with, rather than replaces, caller-supplied params", async () => {
    const plan = await planOf([READ], "read_thing", { limit: 5 })
    expect(plan.query).toEqual({ fields: "+a.b", order: "-created_at", limit: 5 })
  })

  it("LOSES to a caller-supplied value for the same key", async () => {
    // The default must widen a request, never cap it: a caller who names their
    // own `fields` has to get exactly those.
    const plan = await planOf([READ], "read_thing", { fields: "id" })
    expect(plan.query.fields).toBe("id")
    expect(plan.query.order).toBe("-created_at")
  })

  it("leaves a tool without one completely unchanged", async () => {
    const plan = await planOf([NO_DEFAULT], "plain_thing", { limit: 2 })
    expect(plan.query).toEqual({ limit: 2 })
  })

  it("omits the query block entirely when there is nothing to send", async () => {
    const plan = await planOf([NO_DEFAULT], "plain_thing")
    expect(plan.query).toBeUndefined()
  })
})

describe("the stock-location tools carry it for real", () => {
  const find = (n: string) => {
    const t = ADMIN_MCP_TOOLS.find((x) => x.name === n)
    // Without this the assertions below would vacuously pass on a renamed tool.
    expect(t).toBeDefined()
    return t as McpToolDef
  }

  it.each([
    "list_stock_locations",
    "get_stock_location",
    "set_location_fulfillment_providers",
  ])("%s asks for the provider links", (name) => {
    expect(find(name).defaultQuery?.fields).toContain("fulfillment_providers")
  })

  it("asks for them ADDITIVELY, so the address fields survive", () => {
    // A bare `fields=fulfillment_providers.id` REPLACES core's defaults, which
    // would strip the addresses these tools are also relied on for. The `+`
    // prefix appends instead.
    for (const name of ["list_stock_locations", "get_stock_location"]) {
      const fields = find(name).defaultQuery!.fields
      for (const part of fields.split(",")) {
        expect(part.startsWith("+")).toBe(true)
      }
    }
  })

  it("reaches the planned request for the write tool", async () => {
    const plan = await planOf(ADMIN_MCP_TOOLS, "set_location_fulfillment_providers", {
      id: "sloc_1",
      add: ["packlink_packlink"],
    })
    expect(plan.path).toBe("/admin/stock-locations/sloc_1/fulfillment-providers")
    expect(plan.query.fields).toContain("fulfillment_providers")
    expect(plan.body).toEqual({ add: ["packlink_packlink"] })
  })

  it("treats add/remove as deltas — neither is required", async () => {
    // `remove` alone is a legitimate call; requiring both would make detaching
    // a carrier impossible without naming one to keep.
    const plan = await planOf(ADMIN_MCP_TOOLS, "set_location_fulfillment_providers", {
      id: "sloc_1",
      remove: ["packlink_packlink"],
    })
    expect(plan.body).toEqual({ remove: ["packlink_packlink"] })
  })
})
