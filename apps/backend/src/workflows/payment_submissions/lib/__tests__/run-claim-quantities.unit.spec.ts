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

  it("refuses when the run states no quantity to divide", () => {
    // No ceiling means no arithmetic. Allowing here would invent headroom on
    // exactly the runs whose records are weakest.
    const overclaimed = assessRunClaims({
      requestedByRun: requestedRunQuantities([
        { production_run_ids: ["run_a"], quantity: 1 },
      ]),
      runs: new Map([["run_a", { quantity: null }]]),
      tallies: foldRunClaimTallies([live(["run_a"], 1)]),
    })
    expect(overclaimed).toHaveLength(1)
    expect(overclaimed[0]?.ceiling).toBe(0)
  })

  it("says nothing about a run nobody has claimed", () => {
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
