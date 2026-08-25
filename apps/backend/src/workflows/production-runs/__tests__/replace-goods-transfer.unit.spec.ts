import { assertReplaceableTransfer } from "../create-production-run-transfer"

/**
 * Re-booking a hop the carrier cancelled (#891 follow-up).
 *
 * The guard this covers decides whether a NEW transfer may point back at an old
 * one. Both wrong answers cost something real:
 *
 * · allowing a transfer from ANOTHER run links two unrelated movements, and the
 *   run's goods location is read from that list;
 * · allowing a LIVE one leaves two open movements for the same consignment,
 *   which double-counts the moment inventory learns to follow a transfer (S3).
 */

const RUN = "prod_run_01KYPM4G2S85PX61HT25T8BFDT"

const transfer = (over: any = {}) => ({
  id: "gtrf_old",
  production_run_id: RUN,
  status: "cancelled",
  ...over,
})

describe("assertReplaceableTransfer", () => {
  it("allows a cancelled hop on this run to be re-booked", () => {
    expect(() =>
      assertReplaceableTransfer(transfer(), RUN, "gtrf_old")
    ).not.toThrow()
  })

  it("refuses a transfer that belongs to another run", () => {
    expect(() =>
      assertReplaceableTransfer(
        transfer({ production_run_id: "prod_run_someone_else" }),
        RUN,
        "gtrf_old"
      )
    ).toThrow(/not found on production run/)
  })

  it("refuses a transfer that does not exist", () => {
    // 🔑 A missing row must not be treated as "nothing to link" and quietly
    // succeed: the operator asked to replace something specific.
    expect(() => assertReplaceableTransfer(null, RUN, "gtrf_ghost")).toThrow(
      /gtrf_ghost/
    )
  })

  it.each(["draft", "in_transit", "delivered"])(
    "refuses to replace a %s hop — it is still live",
    (status) => {
      expect(() =>
        assertReplaceableTransfer(transfer({ status }), RUN, "gtrf_old")
      ).toThrow(/not cancelled/)
    }
  )

  it("names the status it refused, so the operator knows what to do next", () => {
    expect(() =>
      assertReplaceableTransfer(transfer({ status: "in_transit" }), RUN, "gtrf_old")
    ).toThrow(/"in_transit"/)
  })
})
