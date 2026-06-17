import {
  executeOperationsRecursive,
  findNextOperations,
} from "../execute-visual-flow"

/**
 * #459 P1 — live-executor traversal guard unit tests. Pure, no container — fast.
 *
 * Verifies the `visited` set added to `executeOperationsRecursive` so each canvas
 * node runs at most once per execution: fixes diamond-join double-execution and
 * cyclic-graph infinite loops, while leaving linear/branch flows unchanged.
 */

type Op = {
  id: string
  operation_key: string
  operation_type: string
  position_x: number
  position_y: number
}

const op = (id: string, type = "log"): Op => ({
  id,
  operation_key: `${type}_${id}`,
  operation_type: type,
  position_x: 0,
  position_y: 0,
})

const conn = (
  source_id: string,
  target_id: string,
  handle = "default"
) => ({
  source_id,
  target_id,
  source_handle: handle,
  connection_type:
    handle === "success" || handle === "failure" ? handle : "default",
})

/**
 * Builds a fake per-op executor that records execution order and returns canned
 * results. `branches` maps an op id → the `_branch` a condition node resolves to.
 */
const makeExecOp = (branches: Record<string, string> = {}) => {
  const order: string[] = []
  const execOp = async (operation: any) => {
    order.push(operation.id)
    const data: Record<string, any> = {}
    if (operation.operation_type === "condition") {
      data._branch = branches[operation.id] ?? "success"
    }
    return { success: true, data }
  }
  return { order, execOp }
}

const run = (
  start: Op[],
  all: Op[],
  connections: any[],
  branches?: Record<string, string>
) => {
  const { order, execOp } = makeExecOp(branches)
  return executeOperationsRecursive(
    start,
    all,
    connections,
    {} as any,
    "exec-1",
    "flow-1",
    null,
    null as any,
    new Set<string>(),
    execOp as any
  ).then(() => order)
}

describe("visual_flows/execute-visual-flow traversal guard", () => {
  it("runs a diamond join node exactly once", async () => {
    // a -> b, a -> c, b -> d, c -> d
    const [a, b, c, d] = [op("a"), op("b"), op("c"), op("d")]
    const all = [a, b, c, d]
    const connections = [
      conn("a", "b"),
      conn("a", "c"),
      conn("b", "d"),
      conn("c", "d"),
    ]

    const order = await run([a], all, connections)

    expect(order.filter((id) => id === "d")).toHaveLength(1)
    expect(order.sort()).toEqual(["a", "b", "c", "d"])
    expect(order).toHaveLength(4)
  })

  it("terminates on a cyclic graph, running each node once", async () => {
    // a -> b -> a (cycle)
    const [a, b] = [op("a"), op("b")]
    const all = [a, b]
    const connections = [conn("a", "b"), conn("b", "a")]

    const order = await run([a], all, connections)

    expect(order).toEqual(["a", "b"])
  })

  it("leaves a linear flow unchanged (each node once, in order)", async () => {
    const [a, b, c] = [op("a"), op("b"), op("c")]
    const all = [a, b, c]
    const connections = [conn("a", "b"), conn("b", "c")]

    const order = await run([a], all, connections)

    expect(order).toEqual(["a", "b", "c"])
  })

  it("follows only the active branch of a condition node", async () => {
    // cond --success--> x ; cond --failure--> y
    const cond = op("cond", "condition")
    const [x, y] = [op("x"), op("y")]
    const all = [cond, x, y]
    const connections = [
      conn("cond", "x", "success"),
      conn("cond", "y", "failure"),
    ]

    const order = await run([cond], all, connections, { cond: "success" })

    expect(order).toEqual(["cond", "x"])
    expect(order).not.toContain("y")
  })

  it("findNextOperations filters condition branches by handle", () => {
    const cond = op("cond", "condition")
    const [x, y] = [op("x"), op("y")]
    const connections = [
      conn("cond", "x", "success"),
      conn("cond", "y", "failure"),
    ]

    const next = findNextOperations(
      cond,
      { success: true, data: { _branch: "failure" } },
      [cond, x, y],
      connections
    )

    expect(next.map((o: any) => o.id)).toEqual(["y"])
  })
})
