import { describe, it, expect } from "@jest/globals"
import {
  PLAN_INPUT_SCHEMA,
  runAssistantPlan,
  buildRunPlanTool,
} from "../index"
import type { McpToolResult } from "../../mcp-core"

const ok = (tool: string, data: unknown): McpToolResult => ({ ok: true, tool, data })

describe("assistant-context: PLAN_INPUT_SCHEMA", () => {
  it("declares a recursive steps array via $defs", () => {
    expect(PLAN_INPUT_SCHEMA.type).toBe("object")
    expect(PLAN_INPUT_SCHEMA.required).toContain("steps")
    expect(PLAN_INPUT_SCHEMA.properties.steps.items.$ref).toBe("#/$defs/step")
    expect(PLAN_INPUT_SCHEMA.$defs.step.properties.steps.items.$ref).toBe("#/$defs/step")
    expect(PLAN_INPUT_SCHEMA.$defs.step.properties.fallback.$ref).toBe("#/$defs/fallback")
  })
})

describe("assistant-context: runAssistantPlan", () => {
  const ctx = { baseUrl: "http://localhost:9000" } as any

  it("runs a plan through the supplied dispatch, substituting refs", async () => {
    const dispatch = jest.fn(async (name: string, args: any) => {
      if (name === "list_customers") return ok(name, { customers: [{ id: "cus_1" }] })
      if (name === "list_orders") return ok(name, { orders: [{ customer_id: args.customer_id }] })
      return { ok: false, tool: name, error: "unknown" }
    })

    const r = await runAssistantPlan(
      { ctx, tools: [], dispatch },
      [
        { tool: "list_customers", args: { email: "a@b.com" }, as: "c", extract: "customers.0.id" },
        { tool: "list_orders", args: { customer_id: "$c" } },
      ]
    )

    expect(r.ok).toBe(true)
    expect(r.toolCalls).toBe(2)
    expect(dispatch).toHaveBeenNthCalledWith(2, "list_orders", { customer_id: "cus_1" })
  })

  it("resolves entity ids from the cache-backed resolver instead of re-lookup", async () => {
    const dispatch = jest.fn(async (name: string, args: any) =>
      ok(name, { orders: [{ customer_id: args.customer_id }] })
    )
    const resolveEntity = jest.fn(async () => "cus_01KS9B")

    const r = await runAssistantPlan(
      { ctx, tools: [], dispatch, resolveEntity },
      [
        { resolve: "customer", by: "email", value: "delhi@gmail.com", as: "c" },
        { tool: "list_orders", args: { customer_id: "$c" } },
      ]
    )

    expect(r.ok).toBe(true)
    expect(resolveEntity).toHaveBeenCalledWith("customer", "email", "delhi@gmail.com")
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith("list_orders", { customer_id: "cus_01KS9B" })
  })
})

describe("assistant-context: buildRunPlanTool", () => {
  it("builds a tool whose execute runs a plan and applies the cap", async () => {
    const dispatch = jest.fn(async (name: string) =>
      ok(name, { designs: [{ id: "d1" }, { id: "d2" }] })
    )
    const cap = jest.fn((result: unknown) => result)

    const t: any = buildRunPlanTool({
      ctx: { baseUrl: "http://localhost:9000" } as any,
      tools: [],
      dispatch,
      cap,
    })

    const out = await t.execute({
      steps: [{ tool: "list_designs", args: {}, as: "designs" }],
    })

    expect(dispatch).toHaveBeenCalledWith("list_designs", {})
    expect(cap).toHaveBeenCalled()
    expect(out.ok).toBe(true)
  })

  it("tolerates a missing steps array without throwing", async () => {
    const dispatch = jest.fn()
    const t: any = buildRunPlanTool({
      ctx: { baseUrl: "http://localhost:9000" } as any,
      tools: [],
      dispatch,
    })

    const out = await t.execute({})

    expect(dispatch).not.toHaveBeenCalled()
    expect(out.ok).toBe(true)
  })
})