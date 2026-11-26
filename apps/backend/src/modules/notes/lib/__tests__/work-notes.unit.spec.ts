import { countByBox, dueLabel, formatRef, isOverdue, parseRef, sortOpenNotes } from "../work-notes"

const NOW = new Date("2026-11-26T10:00:00Z").getTime()
const note = (over: any) => ({
  id: "wnote_x", ref: 1, body: "b", kind: "note", status: "open", due_at: null,
  board: "pending-work", node_key: null, entity_name: null, entity_id: null, href: null, ...over,
})

describe("work notes — references", () => {
  it("reads every way the founder might quote a note", () => {
    expect(parseRef("N-12")).toBe(12)
    expect(parseRef("n12")).toBe(12)
    expect(parseRef("#12")).toBe(12)
    expect(parseRef(" 12 ")).toBe(12)
    expect(formatRef(12)).toBe("N-12")
  })

  it("a note id is looked up by id, and anything else is refused rather than guessed", () => {
    expect(parseRef("wnote_01ABC")).toBeNull()
    expect(() => parseRef("N-twelve")).toThrow(/not a note reference/)
    expect(() => parseRef("")).toThrow()
  })
})

describe("work notes — due dates", () => {
  it("counts calendar days, so a note due today stays 'due today' all day", () => {
    expect(dueLabel("2026-11-26", NOW)).toBe("due today")
    expect(dueLabel("2026-11-27", NOW)).toBe("due in 1 day")
    expect(dueLabel("2026-11-24", NOW)).toBe("overdue 2 days")
    expect(dueLabel(null, NOW)).toBeNull()
  })

  it("only an OPEN note past its date is overdue", () => {
    expect(isOverdue(note({ due_at: "2026-11-20" }), NOW)).toBe(true)
    expect(isOverdue(note({ due_at: "2026-11-20", status: "done" }), NOW)).toBe(false)
    expect(isOverdue(note({ due_at: null }), NOW)).toBe(false)
  })

  it("orders by due date first; undated notes never jump ahead of dated ones", () => {
    const sorted = sortOpenNotes([
      note({ ref: 1 }),
      note({ ref: 2, due_at: "2026-12-05" }),
      note({ ref: 3, due_at: "2026-11-20" }),
      note({ ref: 4 }),
    ] as any)
    expect(sorted.map((n) => n.ref)).toEqual([3, 2, 1, 4])
  })
})

describe("work notes — per box", () => {
  it("counts open notes per box and ignores done or unpinned ones", () => {
    const m = countByBox([
      note({ node_key: "balances-due" }),
      note({ node_key: "balances-due" }),
      note({ node_key: "balances-due", status: "done" }),
      note({ node_key: null }),
    ] as any)
    expect(Object.fromEntries(m)).toEqual({ "balances-due": 2 })
  })
})
