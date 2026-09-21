/**
 * One definition of "can this partner bill for this task".
 *
 * The rule was enforced in the create workflow and duplicated as a constant in
 * the partner UI's claim screen. They agreed, which is exactly why it survived:
 * nothing failed, and nothing made them agree either. These tests pin the rule
 * so the two cannot drift apart silently — the failure mode being a partner
 * offered a task the server then refuses, at the end of a filled-in form.
 */
import {
  isTaskPayable,
  taskPayableVerdict,
  PAYABLE_TASK_STATUSES,
} from "../task-payable"

const task = (over: Record<string, any> = {}) => ({
  id: "task_1",
  title: "Photoshoot",
  status: "completed",
  parent_task_id: null,
  estimated_cost: 5000,
  actual_cost: null,
  cost_currency: "inr",
  cost_type: "total",
  ...over,
})

describe("taskPayableVerdict", () => {
  it("allows a finished task with an agreed cost", () => {
    expect(taskPayableVerdict(task())).toEqual({
      payable: true,
      reason: null,
      amount: 5000,
    })
  })

  /*
   * The live case on 2026-09-21: Mehak Chauhan's ₹5,000 Photoshoot, parent
   * `pending` with its subtask `in_progress`. The claim screen was right to
   * withhold it — but it withheld it SILENTLY, which is what made the platform
   * look broken rather than the task look unfinished.
   */
  it("withholds an unfinished task and says why", () => {
    const v = taskPayableVerdict(task({ status: "pending" }))

    expect(v.payable).toBe(false)
    expect(v.reason).toContain("Not finished")
    expect(v.reason).toContain("pending")
    // The amount is still reported, so a partner can see what it is worth.
    expect(v.amount).toBe(5000)
  })

  it.each(["in_progress", "assigned", "cancelled", ""])(
    "refuses status %s",
    (status) => {
      expect(isTaskPayable(task({ status }))).toBe(false)
    }
  )

  it("prefers actual_cost over estimated_cost", () => {
    expect(taskPayableVerdict(task({ actual_cost: 4200 })).amount).toBe(4200)
  })

  /*
   * 🔴 `Number(null)` is 0. Without separating absence from zero, a task with
   * no agreed cost would read as a free job and be submittable at ₹0.
   */
  it("tells a missing cost apart from a zero cost", () => {
    const missing = taskPayableVerdict(
      task({ estimated_cost: null, actual_cost: null })
    )
    expect(missing).toMatchObject({
      payable: false,
      reason: "No cost agreed on this task",
      amount: null,
    })

    const zero = taskPayableVerdict(
      task({ estimated_cost: 0, actual_cost: null })
    )
    expect(zero.payable).toBe(false)
    expect(zero.reason).toContain("zero")
    expect(zero.amount).toBe(0)
  })

  /*
   * The cost sits on the parent and the work on its children. Offering both is
   * an invitation to bill one job twice.
   */
  it("never offers a subtask on its own", () => {
    const v = taskPayableVerdict(
      task({ parent_task_id: "task_parent", status: "completed" })
    )

    expect(v.payable).toBe(false)
    expect(v.reason).toContain("parent task")
  })

  it("reports doneness before cost when both are wrong", () => {
    const v = taskPayableVerdict(
      task({ status: "in_progress", estimated_cost: null })
    )
    // "finish it" is something the partner can act on; "no cost" needs an admin.
    expect(v.reason).toContain("Not finished")
  })

  it("survives a junk row without throwing", () => {
    expect(taskPayableVerdict({} as any).payable).toBe(false)
    expect(taskPayableVerdict(null as any).payable).toBe(false)
  })

  it("keeps `completed` as the only payable status", () => {
    expect([...PAYABLE_TASK_STATUSES]).toEqual(["completed"])
  })
})
