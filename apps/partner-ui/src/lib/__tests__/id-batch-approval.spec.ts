import { describe, expect, it } from "vitest"

import {
  buildApprovePayload,
  buildItemCorrection,
  isApprovable,
} from "../id-batch-approval"
import type { IdExtractionDraft } from "../../hooks/api/id-extraction-batch"

const draft = (over: Partial<IdExtractionDraft> = {}): IdExtractionDraft => ({
  first_name: "Tarun",
  last_name: "Debnath",
  gender: "male",
  date_of_birth: "1988-04-02",
  id_type: "aadhaar",
  id_last4: "4021",
  address: {
    street: "12 Weavers Lane",
    city: "Shantipur",
    state: "West Bengal",
    postal_code: "741404",
    country: "IN",
  },
  ...over,
})

describe("buildItemCorrection", () => {
  it("sends nothing when the operator changed nothing", () => {
    expect(
      buildItemCorrection(draft(), {
        first_name: "Tarun",
        address: { city: "Shantipur" },
      })
    ).toBeNull()
  })

  it("sends only the field that actually changed", () => {
    expect(
      buildItemCorrection(draft(), { first_name: "Tarun ", last_name: "Dey" })
    ).toEqual({ last_name: "Dey" })
  })

  it("treats a field the operator emptied as a clear, not as untouched", () => {
    expect(buildItemCorrection(draft(), { gender: "  " })).toEqual({
      gender: null,
    })
  })

  it("carries the WHOLE address when one address field is edited", () => {
    // 🔴 The regression this file exists for. The server merges shallowly, so
    // a correction of `{ address: { city } }` deletes the four fields the
    // reader got right. Anything less than the full address here is a bug.
    const correction = buildItemCorrection(draft(), {
      address: { city: "Kolkata" },
    })

    expect(correction).toEqual({
      address: {
        street: "12 Weavers Lane",
        city: "Kolkata",
        state: "West Bengal",
        postal_code: "741404",
        country: "IN",
      },
    })
  })

  it("does not send an address at all when only untouched address fields are held", () => {
    expect(
      buildItemCorrection(draft(), { address: { state: "West Bengal" } })
    ).toBeNull()
  })

  it("builds an address from nothing when the reader found none", () => {
    expect(
      buildItemCorrection(draft({ address: null }), {
        address: { city: "Kolkata" },
      })
    ).toEqual({
      address: {
        street: null,
        city: "Kolkata",
        state: null,
        postal_code: null,
        country: null,
      },
    })
  })
})

describe("buildApprovePayload", () => {
  const items = [
    { id: "item_1", draft: draft() },
    { id: "item_2", draft: draft({ first_name: "Tapas", last_name: "Gui" }) },
    { id: "item_3", draft: null },
  ]

  it("names the selected items explicitly, even when everything is selected", () => {
    // Omitting item_ids means "everything with a usable draft" server-side —
    // a different set if a retry lands between the render and the click.
    const payload = buildApprovePayload(
      items,
      ["item_1", "item_2", "item_3"],
      {}
    )
    expect(payload.item_ids).toEqual(["item_1", "item_2", "item_3"])
    expect(payload.corrections).toBeUndefined()
  })

  it("ignores edits belonging to items that were not selected", () => {
    const payload = buildApprovePayload(items, ["item_1"], {
      item_1: { last_name: "Dey" },
      item_2: { last_name: "Guin" },
    })
    expect(payload.item_ids).toEqual(["item_1"])
    expect(payload.corrections).toEqual({ item_1: { last_name: "Dey" } })
  })

  it("drops ids that are not in the batch rather than passing them through", () => {
    expect(buildApprovePayload(items, ["item_1", "nope"], {}).item_ids).toEqual([
      "item_1",
    ])
  })
})

describe("isApprovable", () => {
  it("refuses a draft with no name", () => {
    expect(
      isApprovable({
        id: "i",
        status: "completed",
        draft: draft({ first_name: null, last_name: null }),
      })
    ).toBe(false)
  })

  it("lets a correction rescue a draft the reader refused", () => {
    expect(
      isApprovable(
        {
          id: "i",
          status: "completed",
          draft: draft({ first_name: null, last_name: null }),
        },
        { first_name: "Tarun" }
      )
    ).toBe(true)
  })

  it("refuses an item that was already approved", () => {
    expect(
      isApprovable({ id: "i", status: "approved", draft: draft() })
    ).toBe(false)
  })

  it("refuses an item that was never read", () => {
    expect(isApprovable({ id: "i", status: "failed", draft: null })).toBe(false)
  })
})
