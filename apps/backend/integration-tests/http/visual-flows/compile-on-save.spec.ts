import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { createVisualFlowWorkflow } from "../../../src/workflows/visual-flows/create-visual-flow"
import { updateVisualFlowWorkflow } from "../../../src/workflows/visual-flows/update-visual-flow"
import { VISUAL_FLOWS_MODULE } from "../../../src/modules/visual_flows"

jest.setTimeout(60 * 1000)

// Build a canvas graph + matching DB operations from a compact spec.
const node = (id: string, type: string, options: Record<string, any> = {}) => ({
  id: `op_${id}`,
  type: "operation",
  position: { x: 0, y: 0 },
  data: { operationType: type, operationKey: `${type}_${id}`, options },
})
const edge = (s: string, t: string, sourceHandle = "default") => ({
  id: `${s}->${t}`,
  source: s === "trigger" ? "trigger" : `op_${s}`,
  target: `op_${t}`,
  sourceHandle,
})
const opRow = (id: string, type: string, sort: number) => ({
  operation_key: `${type}_${id}`,
  operation_type: type,
  name: `${type} ${id}`,
  options: {},
  position_x: 0,
  position_y: 0,
  sort_order: sort,
})

setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("visual-flows/compile-on-save (#459 P1)", () => {
    let container: any
    let service: any

    beforeEach(() => {
      container = getContainer()
      service = container.resolve(VISUAL_FLOWS_MODULE)
    })

    it("persists a valid compiled plan when creating an active flow", async () => {
      const { result } = await createVisualFlowWorkflow(container).run({
        input: {
          name: "compile-valid-active",
          status: "active",
          trigger_type: "manual",
          canvas_state: {
            nodes: [node("a", "log"), node("b", "log")],
            edges: [edge("trigger", "a"), edge("a", "b")],
          },
          operations: [opRow("a", "log", 0), opRow("b", "log", 1)],
        },
      })

      const plan = await service.getCompiledPlan(result.id)
      expect(plan).toBeTruthy()
      expect(plan.ok).toBe(true)
      expect(plan.errors).toHaveLength(0)
      expect(plan.entrypoints).toEqual(["op_a"])
      expect(plan.levels).toEqual([["op_a"], ["op_b"]])
      expect(plan.hash).toMatch(/^[0-9a-f]{64}$/)

      const flow = await service.retrieveVisualFlow(result.id)
      expect(flow.compiled_hash).toBe(plan.hash)
    })

    it("allows saving a DRAFT with a cyclic graph but records ok:false", async () => {
      const { result } = await createVisualFlowWorkflow(container).run({
        input: {
          name: "compile-cyclic-draft",
          status: "draft",
          trigger_type: "manual",
          canvas_state: {
            nodes: [node("a", "log"), node("b", "log")],
            edges: [edge("trigger", "a"), edge("a", "b"), edge("b", "a")],
          },
          operations: [opRow("a", "log", 0), opRow("b", "log", 1)],
        },
      })

      const plan = await service.getCompiledPlan(result.id)
      expect(plan.ok).toBe(false)
      expect(plan.errors.join(" ")).toMatch(/cycle|entrypoint/i)
    })

    it("blocks activating a flow with an invalid (cyclic) graph", async () => {
      const { errors } = await createVisualFlowWorkflow(container).run({
        throwOnError: false,
        input: {
          name: "compile-cyclic-active",
          status: "active",
          trigger_type: "manual",
          canvas_state: {
            nodes: [node("a", "log"), node("b", "log")],
            edges: [edge("trigger", "a"), edge("a", "b"), edge("b", "a")],
          },
          operations: [opRow("a", "log", 0), opRow("b", "log", 1)],
        },
      })

      expect(errors).toBeDefined()
      expect(errors.length).toBeGreaterThan(0)
      expect(JSON.stringify(errors)).toMatch(/cannot activate flow|cycle/i)
    })

    it("recompiles on update and blocks activation of an invalid graph", async () => {
      // Start as a valid draft …
      const { result: created } = await createVisualFlowWorkflow(container).run({
        input: {
          name: "compile-update-activate",
          status: "draft",
          trigger_type: "manual",
          canvas_state: {
            nodes: [node("a", "log")],
            edges: [edge("trigger", "a")],
          },
          operations: [opRow("a", "log", 0)],
        },
      })

      // … then activate with a now-valid two-node graph → compiles + persists.
      const { result: updated } = await updateVisualFlowWorkflow(container).run({
        input: {
          id: created.id,
          status: "active",
          canvas_state: {
            nodes: [node("a", "log"), node("b", "log")],
            edges: [edge("trigger", "a"), edge("a", "b")],
          },
          operations: [opRow("a", "log", 0), opRow("b", "log", 1)],
        },
      })

      const plan = await service.getCompiledPlan(updated.id)
      expect(plan.ok).toBe(true)
      expect(plan.levels).toEqual([["op_a"], ["op_b"]])
    })
  })
})
