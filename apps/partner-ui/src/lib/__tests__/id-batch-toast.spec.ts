import { describe, expect, it } from "vitest"

import { idExtractionBatchIdFrom } from "../id-batch-toast"

/**
 * The seam between an approved tool call and the progress toast (#1816).
 *
 * `create_id_extraction_batch` answers 202 and then reads photographs for
 * minutes afterwards, so this extractor is the only thing standing between the
 * partner and three minutes of silence. It reads a tool result — an envelope
 * this code does not own — which is exactly the shape that fails quietly: pick
 * the wrong key and the feature is wired, compiles, and does nothing.
 */
describe("idExtractionBatchIdFrom", () => {
  it("reads the id from the route's own 202 body", () => {
    expect(
      idExtractionBatchIdFrom("create_id_extraction_batch", {
        message: "Reading started.",
        batch_id: "01M1R4XVAEW82NBDY9TZ4SQY8N",
        total_images: 10,
        confirmed: true,
      })
    ).toBe("01M1R4XVAEW82NBDY9TZ4SQY8N")
  })

  it("reads it through the dispatcher's data envelope", () => {
    expect(
      idExtractionBatchIdFrom("create_id_extraction_batch", {
        data: { batch_id: "01M1R4XVAEW82NBDY9TZ4SQY8N" },
      })
    ).toBe("01M1R4XVAEW82NBDY9TZ4SQY8N")
  })

  it("ignores every other tool, however similar its payload", () => {
    expect(
      idExtractionBatchIdFrom("add_person_from_id_card", {
        batch_id: "01M1R4XVAEW82NBDY9TZ4SQY8N",
      })
    ).toBeNull()
    expect(
      idExtractionBatchIdFrom("approve_id_extraction_batch", {
        batch_id: "01M1R4XVAEW82NBDY9TZ4SQY8N",
      })
    ).toBeNull()
  })

  /**
   * A sensitive tool called without confirmation returns a plan rather than a
   * result. Starting a progress toast for work that has not begun would be the
   * "stream with no finish reads as success" failure in miniature.
   */
  it("returns null for a requires_confirmation plan", () => {
    expect(
      idExtractionBatchIdFrom("create_id_extraction_batch", {
        requires_confirmation: true,
        tool: "create_id_extraction_batch",
      })
    ).toBeNull()
  })

  it("survives the shapes a failed call actually produces", () => {
    expect(idExtractionBatchIdFrom("create_id_extraction_batch", null)).toBeNull()
    expect(
      idExtractionBatchIdFrom("create_id_extraction_batch", undefined)
    ).toBeNull()
    expect(
      idExtractionBatchIdFrom("create_id_extraction_batch", { error: "boom" })
    ).toBeNull()
    expect(
      idExtractionBatchIdFrom("create_id_extraction_batch", { batch_id: "" })
    ).toBeNull()
    expect(
      idExtractionBatchIdFrom("create_id_extraction_batch", { batch_id: 42 })
    ).toBeNull()
  })
})
