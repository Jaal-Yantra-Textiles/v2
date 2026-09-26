/**
 * Every field a proxy tool ADVERTISES must be FORWARDED.
 *
 * The dispatcher sends only what `pathParams` / `queryParams` / `bodyParams`
 * claim (`pick(def.bodyParams, args)`); anything else in `inputSchema` is
 * silently dropped. `create_material_transfer` and `receive_material_transfer`
 * (#2144) shipped with a full schema and NO `bodyParams`, so every call reached
 * the route with an empty body and 400'd "expected string, received undefined".
 * Nobody noticed until a founder-approved stock move on prod (#2271).
 *
 * The per-surface field-coverage specs each guard the tools someone thought to
 * list. This one asks the question of the whole registry.
 */
import { ADMIN_MCP_TOOLS } from "../registry"

/** Consumed by the dispatcher itself (see CONTROL_ARGS in mcp-core/dispatch). */
const CONTROL_ARGS = new Set(["dry_run", "confirm", "store", "reason", "context"])


describe("admin MCP registry: advertised fields are forwarded", () => {
  const proxied = ADMIN_MCP_TOOLS.filter((t) => !t.native && t.path)

  it.each(proxied.map((t) => [t.name, t] as const))("%s", (_name, tool) => {
    const claimed = new Set<string>([
      ...(tool.pathParams ?? []),
      ...(tool.queryParams ?? []),
      ...(tool.bodyParams ?? []),
    ])
    const advertised = Object.keys(tool.inputSchema?.properties ?? {})
    const dropped = advertised.filter((k) => !claimed.has(k) && !CONTROL_ARGS.has(k))
    expect(dropped).toEqual([])
  })
})
