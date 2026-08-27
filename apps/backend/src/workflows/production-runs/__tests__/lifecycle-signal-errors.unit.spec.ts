import {
  isAlreadySignalled,
  isMissingLifecycleTransaction,
} from "../lib/lifecycle-signal-errors"

/**
 * #1574 — the whole safety of recovering from a dead lifecycle transaction
 * rests on this predicate being NARROW. Widen it and a genuine signalling
 * failure on a live run gets reported to the partner as a successful finish.
 */
describe("isMissingLifecycleTransaction", () => {
  it("recognises the redis engine's wording (what prod throws)", () => {
    expect(
      isMissingLifecycleTransaction(
        "Transaction tx_01ABC could not be found."
      )
    ).toBe(true)
  })

  it("recognises the in-memory engine's wording (what the tests throw)", () => {
    // Two engines, two spellings of one fact. Matching only the one you
    // happened to see locally is how a fix passes its test and does nothing in
    // production.
    expect(isMissingLifecycleTransaction("Transaction not found")).toBe(true)
  })

  it("does NOT swallow a missing WORKFLOW — that is a deploy problem", () => {
    // 🔴 The closest neighbour, and the one that must still throw. A workflow
    // absent from the registry means the code that owns this run is gone; a
    // partner being told "finished" would be a lie about work nothing tracked.
    expect(
      isMissingLifecycleTransaction(
        'Workflow with id "run-production-run-lifecycle" not found.'
      )
    ).toBe(false)
  })

  it("does NOT swallow ordinary failures", () => {
    expect(isMissingLifecycleTransaction("connection refused")).toBe(false)
    expect(isMissingLifecycleTransaction("step failed: timeout")).toBe(false)
    expect(isMissingLifecycleTransaction("")).toBe(false)
    expect(isMissingLifecycleTransaction(undefined)).toBe(false)
    expect(isMissingLifecycleTransaction(null)).toBe(false)
  })
})

describe("isAlreadySignalled", () => {
  it("recognises the idempotent double-signal", () => {
    // A partner double-clicking Finish is not an error.
    expect(isAlreadySignalled("current status is ok")).toBe(true)
  })

  it("is not confused by a missing transaction", () => {
    expect(isAlreadySignalled("Transaction tx_1 could not be found.")).toBe(
      false
    )
  })
})
