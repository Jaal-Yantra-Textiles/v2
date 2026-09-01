/**
 * When an AI generation gets its own design record (#1721).
 *
 * ## Why this rule is worth a test of its own
 *
 * It was a comment that said "Always create a design entry to save AI
 * generation history", and the code did exactly that — including when the
 * caller had already named the design the image belongs to. One design-chat
 * session on production (2026-09-01) produced THREE design records: the real
 * `Monsoon Kurta`, plus one `AI Design - Sep 1, 12:20 PM` per generated take,
 * all three linked to the same customer.
 *
 * #1698 had already made the chat's `create_design` TOOL idempotent per thread.
 * This workflow is a second creator that fix never touched, which is the whole
 * lesson: enumerate every path that creates the record before calling a
 * duplicate bug closed.
 */
import { shouldCreateHistoryDesign } from "../generate-design-image"

const upload = { media_id: "med_1", media_url: "https://cdn/x.jpg" }

describe("shouldCreateHistoryDesign", () => {
  it("files a standalone generation — nothing else would record it", () => {
    expect(
      shouldCreateHistoryDesign({ input: {}, uploadResult: upload })
    ).toBe(true)
  })

  /**
   * 🔴 The regression. The chat's generate tool passes `design_id` with
   * `mode: "commit"` (see `mastra/agents/tools/storefront-design-flow.ts`), so
   * the commit step attaches the image to that design — and this used to mint a
   * second record for the same picture anyway, once per take.
   */
  it("files NOTHING when the caller already named a design", () => {
    expect(
      shouldCreateHistoryDesign({
        input: { design_id: "01M1EEFGR1AH949RFREWZ6QKVM" },
        uploadResult: upload,
      })
    ).toBe(false)
  })

  it("files nothing when no image was actually stored", () => {
    expect(shouldCreateHistoryDesign({ input: {}, uploadResult: null })).toBe(
      false
    )
    expect(
      shouldCreateHistoryDesign({ input: {}, uploadResult: { media_id: "" } })
    ).toBe(false)
    expect(shouldCreateHistoryDesign({ input: {} })).toBe(false)
  })

  /**
   * ⚠️ `""` is not an id. The commit step gates on `!!design_id` as well, so an
   * empty string attaches the image to nothing — the history record is then the
   * only trace the generation would leave, and suppressing it would lose the
   * image entirely. Pinned because the obvious "tighten the guard" edit here
   * (`design_id === undefined`) would silently do that.
   */
  it("treats an empty-string design_id as no design, matching the commit step", () => {
    expect(
      shouldCreateHistoryDesign({
        input: { design_id: "" },
        uploadResult: upload,
      })
    ).toBe(true)
    expect(
      shouldCreateHistoryDesign({
        input: { design_id: null },
        uploadResult: upload,
      })
    ).toBe(true)
  })
})
