/**
 * Invariants tying the registry to the HTTP scope guard (#1306 Track C).
 *
 * The guard in `src/api/middlewares.ts` classifies a request by HTTP VERB; the
 * registry classifies a tool by its `write` flag. Where the two disagree — a
 * POST route that only reads — a read-only credential would see the tool in
 * `tools/list` and then get a 403 when calling it. That drift is invisible until
 * someone actually holds a read-only token, so it is asserted here instead.
 */
import { ADMIN_MCP_TOOLS } from "../registry"
import { MCP_SCOPE_EXEMPT_ADMIN_PATHS } from "../../../../../lib/mcp-scope"
import { isSensitive } from "../../../../../lib/mcp-core"

describe("registry vs the admin write guard", () => {
  it("every non-GET tool is either flagged `write` or exempted by path", () => {
    const offenders = ADMIN_MCP_TOOLS.filter((t) => {
      if (t.native) return false // natives never touch HTTP
      const method = t.method ?? "GET"
      if (method === "GET") return false
      if (t.write) return false
      return !MCP_SCOPE_EXEMPT_ADMIN_PATHS.includes(t.path ?? "")
    }).map((t) => `${t.name} (${t.method} ${t.path})`)

    expect(offenders).toEqual([])
  })

  it("keeps the transport itself exempt", () => {
    // Every MCP tool call is a POST /admin/mcp, reads included. If this entry
    // ever goes away, a read-only token cannot call the MCP endpoint at all.
    expect(MCP_SCOPE_EXEMPT_ADMIN_PATHS).toContain("/admin/mcp")
  })

  it("exempts no path that a write tool actually uses", () => {
    // The exemption is a hole in the guard, so nothing that mutates may sit
    // behind it.
    const writePaths = new Set(
      ADMIN_MCP_TOOLS.filter((t) => t.write).map((t) => t.path)
    )
    for (const path of MCP_SCOPE_EXEMPT_ADMIN_PATHS) {
      expect(writePaths.has(path)).toBe(false)
    }
  })
})

describe("what a `write`-scoped credential can reach", () => {
  it("excludes every DELETE, because DELETE is implicitly sensitive", () => {
    const deletes = ADMIN_MCP_TOOLS.filter((t) => t.method === "DELETE")
    expect(deletes.length).toBeGreaterThan(0)
    for (const t of deletes) {
      expect(isSensitive(t)).toBe(true)
    }
  })

  it("reaches NOTHING a read-scoped one cannot — every admin write is sensitive", () => {
    // A characterization test, not a requirement. Of 69 write tools, 59 are
    // explicitly `sensitive: true` and the other 10 are DELETEs (implicitly
    // sensitive), so the `write` rung of the ladder is currently EMPTY on this
    // surface: scoping a third-party token to `write` grants it exactly what
    // `read` grants, and every real mutation needs `sensitive`.
    //
    // That is invisible from the ladder itself and it decides what a
    // third-party token is worth, so it is pinned here. When a genuinely
    // non-sensitive write tool lands, this test fails — delete it then, and
    // the `write` rung starts meaning something.
    const plainWrites = ADMIN_MCP_TOOLS.filter(
      (t) => t.write && !isSensitive(t)
    ).map((t) => t.name)
    expect(plainWrites).toEqual([])
  })
})
