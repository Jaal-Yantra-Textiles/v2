import { summarizeMcpUsage, toolNameOf } from "../summarize"

/**
 * The ledger's WRITE side records more than its READ side returned.
 * `recordMcpEvent` stores method/path/outcome/executed/ok/ms/error/context in
 * `metadata` plus `actor_id` on the row; the view surfaced six of those. So the
 * summary could report "3 errors" while no row could name which call failed,
 * what it hit, or why it was made. These pin the field list against what is
 * actually written.
 */
const row = (over: any = {}) => ({
  operation: "mcp:create_inventory_order",
  surface: "admin",
  actor_id: "user_1",
  actor_type: "admin",
  created_at: "2026-09-08T03:33:33.185Z",
  metadata: {
    method: "POST",
    path: "/admin/inventory-orders",
    outcome: "run",
    executed: true,
    ok: true,
    ms: 10194,
    error: null,
    context: "Creating the GOF Asia fabric purchase",
    ...(over.metadata ?? {}),
  },
  ...(() => {
    const { metadata, ...rest } = over
    return rest
  })(),
})

describe("summarizeMcpUsage", () => {
  it("strips the mcp: prefix from the operation", () => {
    expect(toolNameOf({ operation: "mcp:get_product" })).toBe("get_product")
    expect(toolNameOf({ operation: null })).toBe("")
  })

  describe("a recent row carries everything that was recorded", () => {
    const [r] = summarizeMcpUsage([row()], 1).recent

    it("names what it hit, not just that it ran", () => {
      expect(r.method).toBe("POST")
      expect(r.path).toBe("/admin/inventory-orders")
    })

    it("carries the caller's stated intent", () => {
      expect(r.context).toBe("Creating the GOF Asia fabric purchase")
    })

    it("carries the actor id, not just the actor type", () => {
      expect(r.actor_id).toBe("user_1")
      expect(r.actor_type).toBe("admin")
    })

    it("keeps executed separate from outcome", () => {
      expect(r.outcome).toBe("run")
      expect(r.executed).toBe(true)
    })

    it("drops nothing the ledger wrote", () => {
      // The regression guard: a field added to recordMcpEvent and forgotten
      // here is invisible until someone needs it during an incident.
      expect(Object.keys(r).sort()).toEqual(
        [
          "actor_id",
          "actor_type",
          "at",
          "context",
          "error",
          "executed",
          "method",
          "ms",
          "ok",
          "outcome",
          "path",
          "surface",
          "tool",
        ].sort()
      )
    })
  })

  it("surfaces a failure's message and attributes it to a tool", () => {
    const out = summarizeMcpUsage(
      [
        row(),
        row({
          operation: "mcp:update_product_variant",
          metadata: { ok: false, error: "Variant not found", outcome: "run" },
        }),
      ],
      2
    )
    expect(out.errors).toBe(1)
    expect(out.errors_by_tool).toEqual({ update_product_variant: 1 })
    expect(out.recent[1].error).toBe("Variant not found")
    // The healthy tool must not be blamed.
    expect(out.errors_by_tool.create_inventory_order).toBeUndefined()
  })

  it("treats a missing ok as unknown, NOT as a failure", () => {
    // Legacy rows carry no `ok`. Counting absence as failure would invent
    // errors out of history.
    const out = summarizeMcpUsage([row({ metadata: { ok: undefined } })], 1)
    expect(out.errors).toBe(0)
    expect(out.errors_by_tool).toEqual({})
  })

  it("counts per surface and per tool across rows", () => {
    const out = summarizeMcpUsage(
      [
        row(),
        row({ operation: "mcp:get_product", surface: "store" }),
        row({ operation: "mcp:get_product", surface: "store" }),
      ],
      3
    )
    expect(out.by_tool).toEqual({ create_inventory_order: 1, get_product: 2 })
    expect(out.by_surface).toEqual({ admin: 1, store: 2 })
  })

  it("reports total separately from what it returned", () => {
    const out = summarizeMcpUsage([row(), row()], 247)
    expect(out.total).toBe(247)
    expect(out.returned).toBe(2)
  })

  it("caps recent without capping the counts", () => {
    const rows = Array.from({ length: 25 }, () => row())
    const out = summarizeMcpUsage(rows, 25, 20)
    expect(out.recent).toHaveLength(20)
    expect(out.by_tool.create_inventory_order).toBe(25)
  })

  it("tolerates an empty ledger and missing metadata", () => {
    expect(summarizeMcpUsage([], 0).recent).toEqual([])
    const bare = summarizeMcpUsage([{ operation: "mcp:x" } as any], 1).recent[0]
    expect(bare.ok).toBeNull()
    expect(bare.path).toBeNull()
    expect(bare.surface).toBeNull()
  })

  it("labels an unknown surface rather than dropping the row", () => {
    const out = summarizeMcpUsage([{ operation: "mcp:x" } as any], 1)
    expect(out.by_surface).toEqual({ unknown: 1 })
  })
})
