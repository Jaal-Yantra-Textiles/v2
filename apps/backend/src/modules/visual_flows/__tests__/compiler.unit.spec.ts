import "../operations" // populate operationRegistry (compiler reads it; app does this at boot)
import { compileFlow } from "../compiler"

/**
 * #459 P1 — compiler unit tests. Pure, no container — fast.
 * `log`, `condition`, `read_data` are real registered operation types.
 */

const canvas = (nodes: any[], edges: any[]) => ({
  canvas_state: { nodes, edges },
})

const opNode = (id: string, type: string, options: Record<string, any> = {}) => ({
  id,
  data: { operationType: type, operationKey: `${type}_${id}`, options },
})

const edge = (source: string, target: string, sourceHandle = "default") => ({
  id: `${source}->${target}`,
  source,
  target,
  sourceHandle,
})

describe("visual_flows/compiler", () => {
  it("compiles a simple linear graph into topological levels", () => {
    const flow = canvas(
      [opNode("a", "log"), opNode("b", "log"), opNode("c", "log")],
      [edge("trigger", "a"), edge("a", "b"), edge("b", "c")]
    )
    const plan = compileFlow(flow)

    expect(plan.ok).toBe(true)
    expect(plan.errors).toHaveLength(0)
    expect(plan.entrypoints).toEqual(["a"])
    expect(plan.levels).toEqual([["a"], ["b"], ["c"]])
    expect(plan.nodes["a"].next.default).toEqual(["b"])
    expect(plan.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("places independent branches in the same topological level (parallelizable)", () => {
    const flow = canvas(
      [opNode("a", "log"), opNode("b", "log"), opNode("c", "log")],
      [edge("trigger", "a"), edge("a", "b"), edge("a", "c")]
    )
    const plan = compileFlow(flow)

    expect(plan.ok).toBe(true)
    expect(plan.levels[0]).toEqual(["a"])
    expect(plan.levels[1].sort()).toEqual(["b", "c"])
  })

  it("detects a cycle as a hard error", () => {
    const flow = canvas(
      [opNode("a", "log"), opNode("b", "log")],
      [edge("trigger", "a"), edge("a", "b"), edge("b", "a")]
    )
    const plan = compileFlow(flow)

    expect(plan.ok).toBe(false)
    expect(plan.errors.join(" ")).toMatch(/cycle|entrypoint/i)
  })

  it("flags an unknown operation type as a hard error", () => {
    const flow = canvas(
      [opNode("a", "totally_made_up_op")],
      [edge("trigger", "a")]
    )
    const plan = compileFlow(flow)

    expect(plan.ok).toBe(false)
    expect(plan.errors.join(" ")).toMatch(/unknown operation type/i)
  })

  it("flags an edge to a missing node as a hard error", () => {
    const flow = canvas([opNode("a", "log")], [edge("trigger", "a"), edge("a", "ghost")])
    const plan = compileFlow(flow)

    expect(plan.ok).toBe(false)
    expect(plan.errors.join(" ")).toMatch(/unknown node 'ghost'/i)
  })

  it("records condition branch handles (success/failure)", () => {
    const flow = canvas(
      [opNode("c", "condition"), opNode("ok", "log"), opNode("no", "log")],
      [edge("trigger", "c"), edge("c", "ok", "success"), edge("c", "no", "failure")]
    )
    const plan = compileFlow(flow)

    expect(plan.ok).toBe(true)
    expect(plan.nodes["c"].next.success).toEqual(["ok"])
    expect(plan.nodes["c"].next.failure).toEqual(["no"])
  })

  it("does NOT hard-fail on option mismatch when the value is a template token", () => {
    // read_data expects a typed `entity`; a {{ }} token only resolves at runtime.
    const flow = canvas(
      [opNode("a", "read_data", { entity: "{{ $trigger.payload.entity }}" })],
      [edge("trigger", "a")]
    )
    const plan = compileFlow(flow)

    expect(plan.ok).toBe(true) // template tokens never produce hard errors
  })

  it("produces a stable hash for the same graph and a different hash when it changes", () => {
    const a = compileFlow(canvas([opNode("a", "log")], [edge("trigger", "a")]))
    const b = compileFlow(canvas([opNode("a", "log")], [edge("trigger", "a")]))
    const c = compileFlow(
      canvas([opNode("a", "log"), opNode("b", "log")], [edge("trigger", "a"), edge("a", "b")])
    )

    expect(a.hash).toBe(b.hash)
    expect(a.hash).not.toBe(c.hash)
  })

  it("falls back to DB operations/connections when canvas_state is empty", () => {
    const flow = {
      canvas_state: { nodes: [], edges: [] },
      operations: [
        { id: "op1", operation_key: "log_1", operation_type: "log", options: {} },
        { id: "op2", operation_key: "log_2", operation_type: "log", options: {} },
      ],
      connections: [
        { source_id: "trigger", target_id: "op1", source_handle: "default" },
        { source_id: "op1", target_id: "op2", source_handle: "default" },
      ],
    }
    const plan = compileFlow(flow)

    expect(plan.ok).toBe(true)
    expect(plan.entrypoints).toEqual(["op1"])
    expect(plan.levels).toEqual([["op1"], ["op2"]])
  })
})
