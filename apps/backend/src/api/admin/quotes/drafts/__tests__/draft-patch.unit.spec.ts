const retrievePartnerQuote = jest.fn()
const updatePartnerQuotes = jest.fn().mockResolvedValue({})
const listPartnerQuoteLines = jest.fn().mockResolvedValue([])
const createPartnerQuoteLines = jest.fn().mockResolvedValue([])
const deletePartnerQuoteLines = jest.fn().mockResolvedValue(undefined)
const deletePartnerQuotes = jest.fn().mockResolvedValue(undefined)

jest.mock("../../../../../modules/partner-quote", () => ({
  PARTNER_QUOTE_MODULE: "partner_quote",
}))

import { DELETE, PATCH } from "../[id]/route"

const makeReq = (body: any, id = "pq_1") =>
  ({
    params: { id },
    validatedBody: body,
    scope: {
      resolve: () => ({
        retrievePartnerQuote,
        updatePartnerQuotes,
        listPartnerQuoteLines,
        createPartnerQuoteLines,
        deletePartnerQuoteLines,
        deletePartnerQuotes,
      }),
    },
  }) as any

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() }) as any

/**
 * A section saves its OWN answers (#1446).
 *
 * The draft-order rail this mirrors saves each section independently against a
 * persisted row. The failure mode that matters is a section clobbering another
 * section's work on its way past.
 */
describe("PATCH /admin/quotes/drafts/:id", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    retrievePartnerQuote.mockResolvedValue({ id: "pq_1", status: "draft" })
    listPartnerQuoteLines.mockResolvedValue([])
  })

  it("writes only the keys the section actually sent", async () => {
    await PATCH(makeReq({ recipient_company: "Cici Label" }), makeRes())

    const patch = updatePartnerQuotes.mock.calls[0][0]
    expect(patch.recipient_company).toBe("Cici Label")
    // Everything the section stayed silent about must be ABSENT, not undefined:
    // spreading a partial body would blank each omitted column.
    expect("destination_city" in patch).toBe(false)
    expect("deposit_pct" in patch).toBe(false)
  })

  /**
   * 🔑 `0` is a real deposit and `null` is a real clearing. Both must survive a
   * membership test — a truthiness check would drop the first and a `||` would
   * turn it into the 30% platform default.
   */
  it("carries a zero deposit and an explicit null through", async () => {
    await PATCH(makeReq({ deposit_pct: 0, destination_city: null }), makeRes())

    const patch = updatePartnerQuotes.mock.calls[0][0]
    expect(patch.deposit_pct).toBe(0)
    expect(patch.destination_city).toBeNull()
  })

  /**
   * 🔴 The regression this exists to stop: the buyer section saving a company
   * name and silently emptying the basket.
   */
  it("does NOT touch the basket when the section sent no lines", async () => {
    listPartnerQuoteLines.mockResolvedValue([{ id: "l1" }])

    await PATCH(makeReq({ recipient_company: "Cici Label" }), makeRes())

    expect(deletePartnerQuoteLines).not.toHaveBeenCalled()
    expect(createPartnerQuoteLines).not.toHaveBeenCalled()
  })

  it("replaces the whole basket when the items section sends one", async () => {
    listPartnerQuoteLines.mockResolvedValue([{ id: "old" }])

    await PATCH(
      makeReq({ lines: [{ variant_id: "var_1", quantity: 500 }] }),
      makeRes()
    )

    expect(deletePartnerQuoteLines).toHaveBeenCalledWith(["old"])
    expect(createPartnerQuoteLines.mock.calls[0][0]).toEqual([
      expect.objectContaining({ variant_id: "var_1", quantity: 500, position: 0 }),
    ])
  })

  /**
   * An explicitly empty basket IS a clear — distinct from silence above.
   */
  it("empties the basket when the items section sends an empty array", async () => {
    listPartnerQuoteLines.mockResolvedValue([{ id: "old" }])

    await PATCH(makeReq({ lines: [] }), makeRes())

    expect(deletePartnerQuoteLines).toHaveBeenCalledWith(["old"])
    expect(createPartnerQuoteLines).not.toHaveBeenCalled()
  })

  /**
   * 🔴 A URL naming a MINTED quote must not rewrite a frozen price. Checked on
   * the row we just read, not assumed from the caller's choice of route.
   */
  it("refuses a quote that is not a draft", async () => {
    retrievePartnerQuote.mockResolvedValue({ id: "pq_1", status: "active" })

    await expect(
      PATCH(makeReq({ recipient_company: "HIJACKED" }), makeRes())
    ).rejects.toThrow(/not a draft/)

    expect(updatePartnerQuotes).not.toHaveBeenCalled()
  })

  /**
   * 🔴 The basket must be deleted BEFORE the draft that owns it.
   *
   * Deleting the parent while its lines still point at it answers
   * "You tried to set relationship id: <the draft's id>, but such entity does
   * not exist" — which names the row being deleted and so reads as "this draft
   * is missing" rather than "this draft still has children".
   *
   * A draft with an EMPTY basket deletes cleanly, which is precisely why this
   * survived the first probe and only appeared once a real basket was saved.
   * Asserted on invocation order, not on the fact that both were called.
   */
  it("deletes the basket before the draft that owns it", async () => {
    const order: string[] = []
    deletePartnerQuoteLines.mockImplementation(async () => {
      order.push("lines")
    })
    deletePartnerQuotes.mockImplementation(async () => {
      order.push("quote")
    })
    listPartnerQuoteLines.mockResolvedValue([{ id: "l1" }])

    await DELETE(makeReq({}), makeRes())

    expect(order).toEqual(["lines", "quote"])
    // And an array — a bare string is read as a relationship selector.
    expect(deletePartnerQuotes).toHaveBeenCalledWith(["pq_1"])
  })
})
