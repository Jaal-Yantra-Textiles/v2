import {
  assessRunClaims,
  foldRunClaimTallies,
  requestedRunQuantities,
  runsOverclaimedMessage,
} from "../run-claims"

/**
 * #1596 — a run is claimed by QUANTITY, not as a boolean.
 *
 * The founder's case: a partner finishes 1 of 10, bills it, then bills the
 * remaining 9 later at a different price. Under the old whole-run claim the
 * second bill was refused outright, which is what made reject-and-replace the
 * only way to correct a claim — `01M0Y336X9A6DJ9ESZ4HC0RXVM` reached
 * "produced 7 of 9" by rejecting the whole prior claim twice (3 → 4 → 7), and
 * survived only because 4 and 7 were at the same rate.
 *
 * The rule these cases pin is deliberately narrow. It allows exactly one thing
 * that used to be refused: both sides attributable, and their sum inside what
 * the run was ordered for. Every unattributable claim and every unreadable
 * ceiling still refuses, because an absent number must never read as room to
 * bill.
 */

const live = (
  runIds: string[],
  quantity: number | null,
  status = "Pending"
) => ({
  submission_id: "sub_prior",
  submission_status: status,
  production_run_ids: runIds,
  quantity,
})

describe("foldRunClaimTallies (#1596)", () => {
  it("sums the units claimed by lines naming a single run", () => {
    const tallies = foldRunClaimTallies([
      live(["run_a"], 1),
      { ...live(["run_a"], 3), submission_id: "sub_second" },
    ])

    expect(tallies.get("run_a")?.claimed_quantity).toBe(4)
    expect(tallies.get("run_a")?.claimed_wholly).toBe(false)
    expect(tallies.get("run_a")?.claims).toHaveLength(2)
  })

  it("treats a line over SEVERAL runs as claiming each one whole", () => {
    // The line's quantity is their sum — order #79's ₹8,974 / qty 7 covers
    // seven runs — so splitting it back out per run would be an invention.
    const tallies = foldRunClaimTallies([live(["run_a", "run_b"], 7)])

    expect(tallies.get("run_a")?.claimed_wholly).toBe(true)
    expect(tallies.get("run_a")?.claimed_quantity).toBe(0)
    expect(tallies.get("run_b")?.claimed_wholly).toBe(true)
  })

  it("treats a line with no usable quantity as claiming the run whole", () => {
    expect(foldRunClaimTallies([live(["run_a"], null)]).get("run_a")).toEqual(
      expect.objectContaining({ claimed_wholly: true, claimed_quantity: 0 })
    )
    expect(foldRunClaimTallies([live(["run_a"], 0)]).get("run_a")).toEqual(
      expect.objectContaining({ claimed_wholly: true })
    )
  })

  it("a Rejected submission releases its runs", () => {
    const tallies = foldRunClaimTallies([live(["run_a"], 4, "Rejected")])
    expect(tallies.has("run_a")).toBe(false)
  })

  it("a Draft is a live claim — only Rejected releases", () => {
    expect(
      foldRunClaimTallies([live(["run_a"], 2, "Draft")]).get("run_a")
        ?.claimed_quantity
    ).toBe(2)
  })
})

describe("requestedRunQuantities (#1596)", () => {
  it("attributes a stated quantity to a line naming one run", () => {
    const requested = requestedRunQuantities([
      { production_run_ids: ["run_a"], quantity: 1 },
    ])
    expect(requested.get("run_a")).toBe(1)
  })

  it("claims the whole run when the caller states no quantity", () => {
    // Saying nothing has always claimed the whole run. Nothing previously
    // refused may become allowed by accident.
    expect(
      requestedRunQuantities([
        { production_run_ids: ["run_a"], quantity: null },
      ]).get("run_a")
    ).toBeNull()
  })

  it("claims each run whole when one line names several", () => {
    expect(
      requestedRunQuantities([
        { production_run_ids: ["run_a", "run_b"], quantity: 7 },
      ]).get("run_a")
    ).toBeNull()
  })

  it("sums two lines of the same request that name the same run", () => {
    expect(
      requestedRunQuantities([
        { production_run_ids: ["run_a"], quantity: 2 },
        { production_run_ids: ["run_a"], quantity: 3 },
      ]).get("run_a")
    ).toBe(5)
  })

  it("a whole-run claim is STICKY across lines of one request", () => {
    expect(
      requestedRunQuantities([
        { production_run_ids: ["run_a", "run_b"], quantity: 7 },
        { production_run_ids: ["run_a"], quantity: 2 },
      ]).get("run_a")
    ).toBeNull()
  })
})

describe("assessRunClaims (#1596)", () => {
  const runs = new Map([["run_a", { quantity: 10 }]])

  it("ALLOWS the founder's case: 1 of 10 now, the other 9 later", () => {
    const tallies = foldRunClaimTallies([live(["run_a"], 1)])
    const overclaimed = assessRunClaims({
      requestedByRun: requestedRunQuantities([
        { production_run_ids: ["run_a"], quantity: 9 },
      ]),
      runs,
      tallies,
    })
    expect(overclaimed).toEqual([])
  })

  it("refuses the piece that would take the run past what was ordered", () => {
    const tallies = foldRunClaimTallies([live(["run_a"], 9)])
    const overclaimed = assessRunClaims({
      requestedByRun: requestedRunQuantities([
        { production_run_ids: ["run_a"], quantity: 2 },
      ]),
      runs,
      tallies,
    })
    expect(overclaimed).toHaveLength(1)
    expect(overclaimed[0]).toEqual(
      expect.objectContaining({ ceiling: 10, claimed_quantity: 9, requested: 2 })
    )
  })

  it("refuses a claim on a run somebody already took whole", () => {
    const tallies = foldRunClaimTallies([live(["run_a", "run_b"], 7)])
    const overclaimed = assessRunClaims({
      requestedByRun: requestedRunQuantities([
        { production_run_ids: ["run_a"], quantity: 1 },
      ]),
      runs,
      tallies,
    })
    expect(overclaimed[0]?.claimed_wholly).toBe(true)
  })

  it("refuses a whole-run request against ANY prior claim — today's behaviour", () => {
    const tallies = foldRunClaimTallies([live(["run_a"], 1)])
    const overclaimed = assessRunClaims({
      requestedByRun: requestedRunQuantities([
        { production_run_ids: ["run_a"], quantity: null },
      ]),
      runs,
      tallies,
    })
    expect(overclaimed).toHaveLength(1)
    expect(overclaimed[0]?.requested).toBeNull()
  })

  it("refuses when the run's quantity is set but UNUSABLE", () => {
    // No readable ceiling means no arithmetic. Allowing here would invent
    // headroom on exactly the runs whose records are weakest.
    //
    // ⚠️ `0`, not `null`: since #1676 a null quantity is a DECLARATION that the
    // run is open-ended, and it is the one case that does not refuse. A zero is
    // still a broken number.
    const overclaimed = assessRunClaims({
      requestedByRun: requestedRunQuantities([
        { production_run_ids: ["run_a"], quantity: 1 },
      ]),
      runs: new Map([["run_a", { quantity: 0 }]]),
      tallies: foldRunClaimTallies([live(["run_a"], 1)]),
    })
    expect(overclaimed).toHaveLength(1)
    expect(overclaimed[0]?.ceiling).toBe(0)
  })

  it("says nothing about a run nobody has claimed, when the claim is unattributable", () => {
    // An unattributable claim takes the run WHOLE, which is what it is worth.
    // There is no number to compare — see the #1676 block for the case where
    // there IS one.
    expect(
      assessRunClaims({
        requestedByRun: requestedRunQuantities([
          { production_run_ids: ["run_a"], quantity: null },
        ]),
        runs,
        tallies: new Map(),
      })
    ).toEqual([])
  })

  it("allows the exact final piece despite float dust", () => {
    const tallies = foldRunClaimTallies([live(["run_a"], 9.999999)])
    expect(
      assessRunClaims({
        requestedByRun: requestedRunQuantities([
          { production_run_ids: ["run_a"], quantity: 0.000001 },
        ]),
        runs,
        tallies,
      })
    ).toEqual([])
  })
})

describe("runsOverclaimedMessage (#1596)", () => {
  it("names the headroom and who holds the rest, not just the refusal", () => {
    const tallies = foldRunClaimTallies([live(["run_a"], 9)])
    const message = runsOverclaimedMessage(
      assessRunClaims({
        requestedByRun: requestedRunQuantities([
          { production_run_ids: ["run_a"], quantity: 2 },
        ]),
        runs: new Map([["run_a", { quantity: 10 }]]),
        tallies,
      })
    )

    expect(message).toContain("ordered 10")
    expect(message).toContain("already claimed 9")
    expect(message).toContain("1 remaining")
    expect(message).toContain("asks for 2")
    expect(message).toContain("sub_prior")
  })
})

/**
 * #1676 — a FIRST claim is bounded too.
 *
 * `tallies` only holds runs some PRIOR submission claimed, so a run's opening
 * claim used to be compared against nothing at all: a run ordered for 9 could
 * be billed at 100 and this guard would not look. Only a short-closed run was
 * checked, because otherwise the close would have meant nothing.
 *
 * The founder's rule is a pair, and the second half is what makes the first
 * half safe: bound the first claim by the agreed amount, and let a run created
 * with NO agreed quantity be the explicit, per-run opt-out. That turns an
 * implicit absence of validation into a declaration somebody has to make.
 */
describe("assessRunClaims — a first claim (#1676)", () => {
  const first = (quantity: number | null) =>
    requestedRunQuantities([{ production_run_ids: ["run_a"], quantity }])

  it("refuses a first claim for more than the run was ordered for", () => {
    // The headline case: ordered 9, billed 100, nobody had claimed it before.
    const overclaimed = assessRunClaims({
      requestedByRun: first(100),
      runs: new Map([["run_a", { quantity: 9 }]]),
      tallies: new Map(),
    })

    expect(overclaimed).toHaveLength(1)
    expect(overclaimed[0]).toEqual(
      expect.objectContaining({
        run_id: "run_a",
        ceiling: 9,
        claimed_quantity: 0,
        requested: 100,
        claims: [],
      })
    )
  })

  it("allows a first claim within the ordered quantity", () => {
    expect(
      assessRunClaims({
        requestedByRun: first(7),
        runs: new Map([["run_a", { quantity: 9 }]]),
        tallies: new Map(),
      })
    ).toEqual([])
  })

  it("allows the whole ordered quantity, float dust included", () => {
    expect(
      assessRunClaims({
        requestedByRun: first(9.001),
        runs: new Map([["run_a", { quantity: 9 }]]),
        tallies: new Map(),
      })
    ).toEqual([])
  })

  it("names the run's own ceiling in the refusal, with no prior holder", () => {
    const message = runsOverclaimedMessage(
      assessRunClaims({
        requestedByRun: first(100),
        runs: new Map([["run_a", { quantity: 9 }]]),
        tallies: new Map(),
      })
    )

    expect(message).toContain("ordered 9")
    expect(message).toContain("already claimed 0")
    expect(message).toContain("no prior claim")
    expect(message).toContain("asks for 100")
  })

  it("refuses when the row states a quantity that cannot be read", () => {
    // A zero is a broken number, not a declaration — the same rule the
    // second-and-later claims have always applied.
    expect(
      assessRunClaims({
        requestedByRun: first(5),
        runs: new Map([["run_a", { quantity: 0 }]]),
        tallies: new Map(),
      })
    ).toHaveLength(1)
  })

  it("refuses when the row never FETCHED the quantity", () => {
    // 🔴 The trap this guard is one keystroke away from: a `query.graph` that
    // forgot `quantity` produces rows with no such key. Reading that as
    // open-ended would silently disable the ceiling everywhere. Absence of the
    // field is absence of an answer, so it refuses.
    expect(
      assessRunClaims({
        requestedByRun: first(100),
        runs: new Map([["run_a", { produced_quantity: 9 }]]),
        tallies: new Map(),
      })
    ).toHaveLength(1)
  })

  it("says nothing about a run it was never given a row for", () => {
    // Existence and ownership are somebody else's guard; refusing here would
    // block a submit over a run this function was simply not told about.
    expect(
      assessRunClaims({
        requestedByRun: first(100),
        runs: new Map(),
        tallies: new Map(),
      })
    ).toEqual([])
  })

  it("still refuses a first claim above what a SHORT-CLOSED run produced", () => {
    expect(
      assessRunClaims({
        requestedByRun: first(9),
        runs: new Map([
          [
            "run_a",
            { quantity: 9, produced_quantity: 4, short_closed_at: new Date() },
          ],
        ]),
        tallies: new Map(),
      })
    ).toHaveLength(1)
  })
})

/**
 * #1676 — the opt-out. A run created with NO agreed quantity is open-ended:
 * ongoing work, billed as it comes, and deliberately outside the ceiling.
 */
describe("assessRunClaims — an open-ended run (#1676)", () => {
  const openEnded = { quantity: null }

  it("does not bound a first claim of any size", () => {
    expect(
      assessRunClaims({
        requestedByRun: requestedRunQuantities([
          { production_run_ids: ["run_a"], quantity: 1000 },
        ]),
        runs: new Map([["run_a", openEnded]]),
        tallies: new Map(),
      })
    ).toEqual([])
  })

  it("does not bound a LATER claim either", () => {
    expect(
      assessRunClaims({
        requestedByRun: requestedRunQuantities([
          { production_run_ids: ["run_a"], quantity: 50 },
        ]),
        runs: new Map([["run_a", openEnded]]),
        tallies: foldRunClaimTallies([live(["run_a"], 500)]),
      })
    ).toEqual([])
  })

  it("does not refuse even when a prior claim took the run WHOLE", () => {
    // The deliberate cost of the opt-out, and the reason it has to be declared
    // by a person rather than inferred: no agreed amount means no arithmetic
    // for the double-pay guard to do.
    expect(
      assessRunClaims({
        requestedByRun: requestedRunQuantities([
          { production_run_ids: ["run_a"], quantity: 5 },
        ]),
        runs: new Map([["run_a", openEnded]]),
        tallies: foldRunClaimTallies([live(["run_a"], null)]),
      })
    ).toEqual([])
  })

  it("IS bounded once it is short-closed — a close is still a statement", () => {
    // Opting out of an agreed quantity is not opting out of "no more will be
    // made". Without this the close would mean nothing at all on such a run.
    const overclaimed = assessRunClaims({
      requestedByRun: requestedRunQuantities([
        { production_run_ids: ["run_a"], quantity: 5 },
      ]),
      runs: new Map([
        [
          "run_a",
          { quantity: null, produced_quantity: 4, short_closed_at: new Date() },
        ],
      ]),
      tallies: new Map(),
    })

    expect(overclaimed).toHaveLength(1)
    expect(overclaimed[0]?.ceiling).toBe(4)
  })
})
