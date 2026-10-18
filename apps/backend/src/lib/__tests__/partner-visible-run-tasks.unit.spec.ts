import { partnerVisibleRunTasks } from "../partner-visible-run-tasks"

describe("partnerVisibleRunTasks", () => {
  // The shape a re-dispatched run actually has: the first dispatch's tasks
  // cancelled, the second dispatch's pending.
  const redispatched = [
    { id: "old-parent", title: "production-run-x", status: "cancelled" },
    { id: "old-cut", title: "Cutting", status: "cancelled" },
    { id: "old-stitch", title: "Stitching", status: "cancelled" },
    { id: "new-parent", title: "production-run-x", status: "pending" },
    { id: "new-cut", title: "Pattern Cutting", status: "pending" },
    { id: "new-stitch", title: "Stitching", status: "pending" },
    { id: "new-qc", title: "Quality Check", status: "completed" },
  ]

  it("drops the first dispatch's cancelled tasks on a live run", () => {
    const ids = partnerVisibleRunTasks(redispatched, "sent_to_partner").map((t) => t.id)
    expect(ids).toEqual(["new-parent", "new-cut", "new-stitch", "new-qc"])
  })

  it("leaves exactly one Stitching on a re-dispatched run", () => {
    const stitching = partnerVisibleRunTasks(redispatched, "in_progress").filter(
      (t) => t.title === "Stitching"
    )
    expect(stitching).toHaveLength(1)
    expect(stitching[0].status).toBe("pending")
  })

  it("keeps every task on a cancelled run, because that is its history", () => {
    expect(partnerVisibleRunTasks(redispatched, "cancelled")).toHaveLength(7)
  })

  it("treats a missing task list as empty", () => {
    expect(partnerVisibleRunTasks(undefined, "sent_to_partner")).toEqual([])
    expect(partnerVisibleRunTasks(null, "cancelled")).toEqual([])
  })
})
