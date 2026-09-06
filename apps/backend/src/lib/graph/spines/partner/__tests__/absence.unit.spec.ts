import {
  deliveredRuns,
  domainUnverified,
  expectsAdmin,
  expectsPaymentMethod,
  expectsStore,
  whatsappUnverified,
  type RunLike,
} from "../absence"

const run = (over: Partial<RunLike> = {}): RunLike => ({
  id: over.id ?? "pr_1",
  status: "completed",
  partner_id: "pt_1",
  ...over,
})

describe("expectsAdmin", () => {
  it("fires whenever nobody can sign in", () => {
    // 🔴 Unconditional. There is no state in which a partner with no admin is
    // correct: work assigned to them stops dead and the assignment still reads
    // as successful from the admin side.
    expect(expectsAdmin(0)).toBe(true)
  })

  it("stays quiet with even one", () => {
    expect(expectsAdmin(1)).toBe(false)
  })
})

describe("expectsPaymentMethod — the partner spine's approved_product_id", () => {
  it("fires when delivered work has no account to be paid into", () => {
    expect(expectsPaymentMethod([run()], 0, 0)).toBe(true)
  })

  it("fires on an approved submission even with no runs", () => {
    // The debt can exist without a run behind it in this graph.
    expect(expectsPaymentMethod([], 2, 0)).toBe(true)
  })

  it("stays quiet on a partner who is owed nothing yet", () => {
    /*
     * 🔴 The case that decides whether this signal is worth anything. Most
     * partners on the day they are created have no runs and no submissions;
     * asserting unconditionally would dash an edge on all of them and teach
     * the reader to ignore the dashed edges entirely.
     */
    expect(expectsPaymentMethod([], 0, 0)).toBe(false)
  })

  it("stays quiet on work that is not delivered yet", () => {
    expect(expectsPaymentMethod([run({ status: "sent_to_partner" })], 0, 0)).toBe(
      false
    )
    expect(expectsPaymentMethod([run({ status: "cancelled" })], 0, 0)).toBe(false)
  })

  it("stays quiet once a method exists", () => {
    expect(expectsPaymentMethod([run()], 3, 1)).toBe(false)
  })
})

describe("deliveredRuns", () => {
  it("counts only work that was actually delivered", () => {
    const runs = [
      run({ id: "a", status: "completed" }),
      run({ id: "b", status: "in_progress" }),
      run({ id: "c", status: "cancelled" }),
      run({ id: "d", status: "approved" }),
    ]
    expect(deliveredRuns(runs).map((r) => r.id)).toEqual(["a", "d"])
  })

  it("treats a missing status as not delivered", () => {
    // `undefined` must not coerce into the delivered set by accident.
    expect(deliveredRuns([run({ status: null })])).toHaveLength(0)
    expect(deliveredRuns([{ id: "x" }])).toHaveLength(0)
  })
})

describe("expectsStore", () => {
  it("fires on a seller with nothing to sell through", () => {
    expect(expectsStore("seller", 0)).toBe(true)
  })

  it("never fires on the workspace types that produce for someone else", () => {
    /*
     * 🔴 Manufacturers are the majority of the partner base and produce
     * against another party's store by design. Dashing this on them would
     * assert a defect on most partners in the platform.
     */
    for (const type of ["manufacturer", "individual", "designer"]) {
      expect(expectsStore(type, 0)).toBe(false)
    }
  })

  it("stays quiet on a seller who has one", () => {
    expect(expectsStore("seller", 1)).toBe(false)
  })

  it("treats an unset workspace type as not a seller", () => {
    expect(expectsStore(null, 0)).toBe(false)
    expect(expectsStore(undefined, 0)).toBe(false)
  })
})

describe("the configured-but-broken pair", () => {
  it("flags a number that will never receive anything", () => {
    // Unverified, the sender drops the message: a dispatch notification is
    // recorded as sent and never arrives.
    expect(whatsappUnverified("+919000000000", false)).toBe(true)
  })

  it("does not flag having no number at all", () => {
    // 🔴 No number is a CHOICE, not a fault.
    expect(whatsappUnverified(null, false)).toBe(false)
    expect(whatsappUnverified("", false)).toBe(false)
  })

  it("does not flag a verified number", () => {
    expect(whatsappUnverified("+919000000000", true)).toBe(false)
  })

  it("flags a claimed domain that does not resolve", () => {
    expect(domainUnverified("hrhandloom.in", false)).toBe(true)
    expect(domainUnverified("hrhandloom.in", true)).toBe(false)
    expect(domainUnverified(null, false)).toBe(false)
  })
})

describe("resolveExisting — a link row is not a record", () => {
  const { resolveExisting } = require("../../../builder")

  it("drops ids with nothing behind them", async () => {
    /*
     * 🔴 The case measured on the local database: four link rows pointing at
     * person ids that do not exist. Counting the LINKS made the node claim
     * `present` — "a declared link with something on the other end" — with
     * nothing on the other end.
     */
    const query = { graph: async () => ({ data: [{ id: "b" }] }) }
    await expect(resolveExisting(query, "person", ["a", "b", "c"])).resolves.toEqual(
      ["b"]
    )
  })

  it("keeps the link table's order", async () => {
    const query = { graph: async () => ({ data: [{ id: "c" }, { id: "a" }] }) }
    await expect(resolveExisting(query, "person", ["a", "b", "c"])).resolves.toEqual(
      ["a", "c"]
    )
  })

  it("asks nothing when there is nothing to ask about", async () => {
    // An empty id list reads as "no filter" to query.graph and would return
    // EVERY record of that entity.
    const graph = jest.fn()
    await expect(resolveExisting({ graph }, "person", [])).resolves.toEqual([])
    expect(graph).not.toHaveBeenCalled()
  })
})
