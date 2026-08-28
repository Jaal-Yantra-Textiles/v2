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