/**
 * #1268. Approval and dispatch are two workflows in one request with no
 * transaction across them, and approval commits first. These cover the two
 * things that must hold once it has: dispatch acts on identity rather than a
 * label, and a dispatch failure never retroactively claims the approval failed.
 */
const runMock = jest.fn()

jest.mock(
  "../../../../workflows/production-runs/send-production-run-to-production",
  () => ({
    sendProductionRunToProductionWorkflow: () => ({ run: runMock }),
  })
)

import {
  autoDispatchApprovedChildren,
  hasCrossRunOrdering,
  selectDispatchInput,
} from "../auto-dispatch-approved-children"

describe("selectDispatchInput", () => {
  it("prefers ids over names — a name is not an identity (#1261)", () => {
    expect(
      selectDispatchInput({
        id: "run_1",
        dispatch_template_ids: ["tpl_prod"],
        dispatch_template_names: ["Stitching"],
      })
    ).toEqual({ template_ids: ["tpl_prod"] })
  })

  it("falls back to names so approvals recorded before ids still dispatch", () => {
    expect(
      selectDispatchInput({
        id: "run_1",
        dispatch_template_names: ["Cutting"],
      })
    ).toEqual({ template_names: ["Cutting"] })
  })

  it("treats an empty or junk selection as no selection, not as an empty dispatch", () => {
    expect(
      selectDispatchInput({
        id: "run_1",
        dispatch_template_ids: [],
        dispatch_template_names: null,
      })
    ).toBeNull()

    expect(
      selectDispatchInput({
        id: "run_1",
        dispatch_template_ids: ["", null, undefined] as any,
        dispatch_template_names: ["  "].slice(0, 0),
      })
    ).toBeNull()
  })
})

describe("hasCrossRunOrdering", () => {
  it("is true when any child depends on another run", () => {
    expect(
      hasCrossRunOrdering([
        { id: "a" },
        { id: "b", depends_on_run_ids: ["a"] },
      ])
    ).toBe(true)
  })

  it("is false for an empty dependency list", () => {
    expect(hasCrossRunOrdering([{ id: "a", depends_on_run_ids: [] }])).toBe(false)
  })

  it("treats waiting on GOODS as ordering too (#1529)", () => {
    // A stage-0 supplier is an inventory order, not a run, so such a child has
    // NO run edges. Reading run edges alone auto-dispatched it at approval —
    // sending a partner work whose materials had not even been shipped.
    expect(
      hasCrossRunOrdering([
        { id: "a" },
        { id: "b", depends_on_inventory_order_ids: ["inv_1"] },
      ])
    ).toBe(true)
  })
})

describe("autoDispatchApprovedChildren", () => {
  beforeEach(() => {
    runMock.mockReset()
    runMock.mockResolvedValue({ result: {} })
  })

  it("dispatches by id and reports each run that went out", async () => {
    const report = await autoDispatchApprovedChildren({} as any, [
      { id: "run_1", dispatch_template_ids: ["tpl_a", "tpl_b"] },
    ])

    expect(runMock).toHaveBeenCalledWith({
      input: { production_run_id: "run_1", template_ids: ["tpl_a", "tpl_b"] },
    })
    expect(report.dispatched).toEqual(["run_1"])
    expect(report.failed).toEqual([])
  })

  /**
   * The whole point. Before this, the throw escaped the route: the admin was
   * told the approval failed when it had committed, the run was left approved
   * with no tasks, and `assertCanApprove` then refused a retry because the run
   * was no longer pending_review — stuck.
   */
  it("does not throw when a dispatch fails, and names the run and the reason", async () => {
    runMock
      .mockRejectedValueOnce(
        new Error(
          'Ambiguous task template name(s): "Stitching" matches 2 templates'
        )
      )
      .mockResolvedValueOnce({ result: {} })

    const report = await autoDispatchApprovedChildren({} as any, [
      { id: "run_bad", dispatch_template_names: ["Stitching"] },
      { id: "run_good", dispatch_template_ids: ["tpl_a"] },
    ])

    expect(report.failed).toEqual([
      {
        production_run_id: "run_bad",
        message: expect.stringContaining("Ambiguous task template name(s)"),
      },
    ])
    // A failure must not stop the children after it from going out.
    expect(report.dispatched).toEqual(["run_good"])
  })

  it("skips a child that recorded no selection rather than dispatching nothing", async () => {
    const report = await autoDispatchApprovedChildren({} as any, [
      { id: "run_1" },
    ])

    expect(runMock).not.toHaveBeenCalled()
    expect(report.skipped).toEqual(["run_1"])
    expect(report.failed).toEqual([])
  })

  it("dispatches nothing when the batch is ordered — the admin sequences those", async () => {
    const report = await autoDispatchApprovedChildren({} as any, [
      { id: "run_1", dispatch_template_ids: ["tpl_a"] },
      { id: "run_2", dispatch_template_ids: ["tpl_b"], depends_on_run_ids: ["run_1"] },
    ])

    expect(runMock).not.toHaveBeenCalled()
    expect(report.deferred_for_ordering).toBe(true)
    expect(report.dispatched).toEqual([])
  })
})
