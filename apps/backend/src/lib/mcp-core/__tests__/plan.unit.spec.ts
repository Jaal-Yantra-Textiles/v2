import {
  executeMcpPlan,
  navPlanPath,
  isEmptyPlanResult,
  broadenPlanArgs,
} from "../plan"
import type { McpToolResult } from "../types"
import { extractEntityResolutions, buildEntityResolver } from "../../assistant-context/entities"

const ok = (tool: string, data: unknown): McpToolResult => ({ ok: true, tool, data })
const fail = (tool: string, error: string): McpToolResult => ({ ok: false, tool, error })

const ctx = { baseUrl: "http://localhost:9000" } as any
const tools = [] as any[]

describe("navPlanPath", () => {
  it("navigates dot and bracket paths", () => {
    const d = { designs: [{ id: "d1" }, { id: "d2" }] }
    expect(navPlanPath(d, "designs.0.id")).toBe("d1")
    expect(navPlanPath(d, "designs[1].id")).toBe("d2")
    expect(navPlanPath(d, "")).toBe(d)
  })
})

describe("isEmptyPlanResult", () => {
  it("detects empty list and zero count", () => {
    expect(isEmptyPlanResult({ count: 0 })).toBe(true)
    expect(isEmptyPlanResult({ customers: [] })).toBe(true)
    expect(isEmptyPlanResult({ customers: [{ id: "c" }] })).toBe(false)
  })
})

describe("broadenPlanArgs", () => {
  it("shortens a multi-word q then drops it", () => {
    expect(broadenPlanArgs({ q: "Allocation Fixture" })).toEqual({ q: "Allocation" })
    expect(broadenPlanArgs({ q: "Allocation" })).toEqual({})
  })

  it("does not broaden exact natural-key filters", () => {
    expect(broadenPlanArgs({ email: "delhi@gmail.com" })).toEqual({ email: "delhi@gmail.com" })
    expect(broadenPlanArgs({ name: "E2E Content Partner" })).toEqual({ name: "E2E Content Partner" })
    expect(broadenPlanArgs({ id: "cus_01" })).toEqual({ id: "cus_01" })
  })
})

describe("executeMcpPlan", () => {
  it("substitutes $refs across a linear chain", async () => {
    const dispatch = jest.fn(async (name: string, args: any) => {
      if (name === "list_customers") return ok(name, { customers: [{ id: "cus_1" }] })
      if (name === "list_orders") return ok(name, { orders: [{ customer_id: args.customer_id }] })
      return fail(name, "unknown")
    })

    const r = await executeMcpPlan({
      ctx,
      tools,
      dispatch,
      plan: {
        steps: [
          { tool: "list_customers", args: { email: "a@b.com" }, as: "c", extract: "customers.0.id" },
          { tool: "list_orders", args: { customer_id: "$c" } },
        ],
      },
    })

    expect(r.ok).toBe(true)
    expect(r.toolCalls).toBe(2)
    expect(dispatch).toHaveBeenNthCalledWith(2, "list_orders", { customer_id: "cus_1" })
  })

  it("fans out over a map", async () => {
    const dispatch = jest.fn(async (name: string, args: any) => {
      if (name === "list_designs") return ok(name, { designs: [{ id: "d1" }, { id: "d2" }] })
      if (name === "list_production_runs")
        return ok(name, { production_runs: [{ design_id: args.design_id }] })
      return fail(name, "unknown")
    })

    const r = await executeMcpPlan({
      ctx,
      tools,
      dispatch,
      plan: {
        steps: [
          { tool: "list_designs", args: { limit: 2 }, as: "designs" },
          {
            map: "designs",
            item: "d",
            steps: [{ tool: "list_production_runs", args: { design_id: "$d.id" } }],
          },
        ],
      },
    })

    expect(r.ok).toBe(true)
    const value = r.value as any
    expect(value.map).toBe("designs")
    expect(value.count).toBe(2)
    expect(dispatch).toHaveBeenCalledWith("list_production_runs", { design_id: "d1" })
    expect(dispatch).toHaveBeenCalledWith("list_production_runs", { design_id: "d2" })
  })

  it("does not retry an empty exact-key lookup", async () => {
    const dispatch = jest.fn(async (name: string) => ok(name, { customers: [], count: 0 }))

    const r = await executeMcpPlan({
      ctx,
      tools,
      dispatch,
      plan: { steps: [{ tool: "list_customers", args: { email: "no-such@x.com" } }] },
    })

    expect(r.retries).toBe(0)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it("retries with a broadened filter when a list step returns empty", async () => {
    const dispatch = jest.fn(async (name: string, args: any) => {
      if (name === "list_designs") {
        if (args.q === "Allocation Fixture 1787729803080")
          return ok(name, { designs: [], count: 0 })
        return ok(name, { designs: [{ id: "d1" }], count: 1 })
      }
      return fail(name, "unknown")
    })

    const r = await executeMcpPlan({
      ctx,
      tools,
      dispatch,
      plan: {
        steps: [{ tool: "list_designs", args: { q: "Allocation Fixture 1787729803080" } }],
      },
    })

    expect(r.ok).toBe(true)
    expect(r.retries).toBe(1)
    expect(dispatch).toHaveBeenLastCalledWith("list_designs", { q: "Allocation" })
  })

  it("stops and reports failure on a failed step", async () => {
    const dispatch = jest.fn(async () => fail("list_orders", "Route 404"))

    const r = await executeMcpPlan({
      ctx,
      tools,
      dispatch,
      plan: { steps: [{ tool: "list_orders", args: {} }] },
    })

    expect(r.ok).toBe(false)
    expect(r.error).toBe("Route 404")
  })

  it("resolves from memory and skips the lookup tool", async () => {
    const resolve = buildEntityResolver(
      extractEntityResolutions({
        customers: [{ id: "cus_01KS9B", email: "delhi@gmail.com" }],
      })
    )
    const dispatch = jest.fn(async (name: string, args: any) => {
      if (name === "list_orders") return ok(name, { orders: [{ customer_id: args.customer_id }] })
      return fail(name, "unexpected call")
    })

    const r = await executeMcpPlan({
      ctx,
      tools,
      dispatch,
      resolveEntity: resolve,
      plan: {
        steps: [
          { resolve: "customer", by: "email", value: "delhi@gmail.com", as: "c" },
          { tool: "list_orders", args: { customer_id: "$c" } },
        ],
      },
    })

    expect(r.ok).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith("list_orders", { customer_id: "cus_01KS9B" })
  })

  it("falls back to the lookup tool when memory misses", async () => {
    const dispatch = jest.fn(async (name: string, args: any) => {
      if (name === "list_customers") return ok(name, { customers: [{ id: "cus_1" }] })
      if (name === "list_orders") return ok(name, { orders: [{ customer_id: args.customer_id }] })
      return fail(name, "unexpected call")
    })

    const r = await executeMcpPlan({
      ctx,
      tools,
      dispatch,
      resolveEntity: () => null,
      plan: {
        steps: [
          {
            resolve: "customer",
            by: "email",
            value: "x@y.com",
            as: "c",
            fallback: { tool: "list_customers", args: { email: "x@y.com" }, extract: "customers.0.id" },
          },
          { tool: "list_orders", args: { customer_id: "$c" } },
        ],
      },
    })

    expect(r.ok).toBe(true)
    expect(dispatch).toHaveBeenCalledWith("list_customers", { email: "x@y.com" })
    expect(dispatch).toHaveBeenCalledWith("list_orders", { customer_id: "cus_1" })
  })

  it("errors when a resolve misses and no fallback is given", async () => {
    const r = await executeMcpPlan({
      ctx,
      tools,
      dispatch: jest.fn(),
      resolveEntity: () => null,
      plan: { steps: [{ resolve: "customer", by: "email", value: "x@y.com", as: "c" }] },
    })

    expect(r.ok).toBe(false)
    expect(r.error).toContain("No cached customer")
  })
})
/**
 * #1757 — a plan must not smuggle a write past the confirm card.
 *
 * The defect: `dispatchMcpTool` answers a sensitive, unconfirmed call with
 * `{ ok: true, requires_confirmation: true }` and does NOT execute it. The
 * executor's only stop condition was `ok`, so the plan skipped that step and
 * RAN ON — every later step executing against `undefined` refs — while the
 * flag ended up nested under `value`, where no UI reader looks, so no approval
 * card ever rendered. `run_plan` is bound on every partner chat turn.
 *
 * The fix refuses the whole plan before anything runs. The load-bearing
 * assertion in each case below is therefore **dispatch was never called** —
 * "returned an error" would also be true of a plan that ran three writes first.
 */
const sensitiveTools = [
  { name: "list_designs", method: "GET", path: "/x" },
  { name: "mint_quote", method: "POST", path: "/x", write: true, sensitive: true },
  { name: "delete_thing", method: "DELETE", path: "/x", write: true },
  { name: "log_note", method: "POST", path: "/x", write: true },
] as any[]

describe("executeMcpPlan — sensitive steps are refused before anything runs (#1757)", () => {
  it("refuses a plan naming a sensitive tool, executing NOTHING", async () => {
    const dispatch = jest.fn(async (name: string) => ok(name, { id: "x" }))

    const r = await executeMcpPlan({
      ctx,
      tools: sensitiveTools,
      dispatch,
      plan: {
        steps: [
          { tool: "list_designs", as: "designs", extract: "designs.0.id" },
          { tool: "mint_quote", args: { design_id: "$designs" } },
          { tool: "log_note", args: { note: "quoted" } },
        ],
      },
    })

    expect(r.ok).toBe(false)
    expect(r.error).toContain("mint_quote")
    expect(r.error).toContain("cannot run inside a plan")
    // 🔴 The point. Under the defect, step 1 ran, step 2 was skipped with
    // ok:true, and step 3 ran anyway with an undefined ref.
    expect(dispatch).not.toHaveBeenCalled()
    expect(r.toolCalls).toBe(0)
  })

  it("finds a sensitive tool inside a map body — a guard that only walks the top level is no guard", async () => {
    const dispatch = jest.fn(async (name: string) => ok(name, { things: [{ id: "t1" }] }))

    const r = await executeMcpPlan({
      ctx,
      tools: sensitiveTools,
      dispatch,
      plan: {
        steps: [
          { tool: "list_designs", as: "designs" },
          {
            map: "designs",
            item: "d",
            steps: [{ tool: "delete_thing", args: { id: "$d.id" } }],
          },
        ],
      },
    })

    expect(r.ok).toBe(false)
    // DELETE is sensitive via isSensitive even without an explicit flag.
    expect(r.error).toContain("delete_thing")
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("finds a sensitive tool hiding in a resolve fallback", async () => {
    const dispatch = jest.fn(async (name: string) => ok(name, { id: "x" }))

    const r = await executeMcpPlan({
      ctx,
      tools: sensitiveTools,
      dispatch,
      plan: {
        steps: [
          {
            resolve: "quote",
            by: "email",
            value: "buyer@example.com",
            as: "q",
            fallback: { tool: "mint_quote", args: {} },
          },
        ],
      },
    })

    expect(r.ok).toBe(false)
    expect(r.error).toContain("mint_quote")
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("names every sensitive tool, so the model does not fix them one refusal at a time", async () => {
    const r = await executeMcpPlan({
      ctx,
      tools: sensitiveTools,
      dispatch: jest.fn(async (name: string) => ok(name, {})),
      plan: {
        steps: [{ tool: "mint_quote" }, { tool: "delete_thing" }, { tool: "mint_quote" }],
      },
    })

    expect(r.error).toContain("mint_quote")
    expect(r.error).toContain("delete_thing")
    // De-duplicated: the same tool twice is one name, not two.
    expect(r.error!.match(/mint_quote/g)).toHaveLength(1)
  })

  it("still runs a plan of ordinary writes and reads — the guard must not over-refuse", async () => {
    const dispatch = jest.fn(async (name: string) => ok(name, { designs: [{ id: "d1" }] }))

    const r = await executeMcpPlan({
      ctx,
      tools: sensitiveTools,
      dispatch,
      plan: {
        steps: [
          { tool: "list_designs", as: "designs", extract: "designs.0.id" },
          { tool: "log_note", args: { design_id: "$designs" } },
        ],
      },
    })

    expect(r.ok).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch.mock.calls[1][1]).toEqual({ design_id: "d1" })
  })

  /**
   * The mechanism the guard exists to make unreachable, pinned so it is
   * documented rather than merely absent.
   *
   * `tools: []` deliberately bypasses the guard (an empty registry knows
   * nothing about sensitivity) so the OLD executor behaviour is still
   * reachable from a test. It shows why `ok` was never a sufficient stop
   * condition: the confirm response is `ok: true` with `executed: false`, so
   * the loop treats a step that did NOT run as a step that succeeded, stores
   * `undefined` under its `as`, and carries on.
   *
   * If someone deletes the guard, the four cases above go red. If someone also
   * "fixes" dispatch to return ok:false for a confirm, THIS goes red and tells
   * them the two halves are related.
   */
  it("documents why `ok` was not a stop condition: a confirm response is ok:true and does not execute", async () => {
    const dispatch = jest.fn(async (name: string) => {
      if (name === "mint_quote") {
        // Exactly what dispatchMcpTool returns for a sensitive, unconfirmed call.
        return { ok: true, tool: name, requires_confirmation: true } as any
      }
      return ok(name, { designs: [{ id: "d1" }] })
    })

    const r = await executeMcpPlan({
      ctx,
      tools: [], // no registry ⇒ no sensitivity known ⇒ the old path
      dispatch,
      plan: {
        steps: [
          { tool: "list_designs", as: "designs", extract: "designs.0.id" },
          { tool: "mint_quote", args: { design_id: "$designs" }, as: "quote", extract: "quote.id" },
          { tool: "log_note", args: { quote_id: "$quote" } },
        ],
      },
    })

    // The plan reports SUCCESS having never minted anything.
    expect(r.ok).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(3)
    // And the step after the un-run write executed against an undefined ref.
    expect(dispatch.mock.calls[2][1]).toEqual({ quote_id: undefined })
    // The flag the UI would need is nested under `value`, not at the top level —
    // which is the second half of #1757: no approval card could ever render.
    expect((r as any).requires_confirmation).toBeUndefined()
  })

  it("does not treat an UNKNOWN tool as sensitive — dispatch refuses it by name, better than this guard could", async () => {
    const dispatch = jest.fn(async (name: string) => fail(name, `Unknown tool: ${name}`))

    const r = await executeMcpPlan({
      ctx,
      tools: sensitiveTools,
      dispatch,
      plan: { steps: [{ tool: "mint_qoute" }] },
    })

    expect(r.ok).toBe(false)
    expect(r.error).toContain("Unknown tool")
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
