const retrievePartnerQuote = jest.fn()
const updatePartnerQuotes = jest.fn().mockResolvedValue({})
const listPartnerQuoteLines = jest.fn().mockResolvedValue([])
const createPartnerQuoteLines = jest.fn().mockResolvedValue([])
const deletePartnerQuoteLines = jest.fn().mockResolvedValue(undefined)
const deletePartnerQuotes = jest.fn().mockResolvedValue(undefined)

jest.mock("../../../../../modules/partner-quote", () => ({
  PARTNER_QUOTE_MODULE: "partner_quote",
}))

/**
 * The mint handler is stubbed: this suite is about the BODY it is handed, which
 * is the layer the negotiated price died at. What the workflow then does with a
 * `discount_percent` is `line-override`'s own suite.
 */
const mintQuote = jest.fn(async (_req: any, res: any) => res.status(201).json({ quote: {} }))
jest.mock("../../route", () => ({ POST: (...args: any[]) => (mintQuote as any)(...args) }))

import { PATCH } from "../[id]/route"
import { POST as mintDraft } from "../[id]/mint/route"
import { AdminUpdateQuoteDraftReq } from "../../validators"

const graph = jest.fn().mockResolvedValue({ data: [] })

const scope = {
  resolve: (key: string) =>
    key === "query"
      ? { graph }
      : ({
    retrievePartnerQuote,
    updatePartnerQuotes,
    listPartnerQuoteLines,
    createPartnerQuoteLines,
    deletePartnerQuoteLines,
    deletePartnerQuotes,
      } as any),
}

const makeReq = (body: any, id = "pq_1") =>
  ({ params: { id }, validatedBody: body, scope }) as any

const makeRes = () =>
  ({ status: jest.fn().mockReturnThis(), json: jest.fn() }) as any

/**
 * A negotiated price the operator typed must reach the mint (#1806).
 *
 * It reached nothing: the grid bound the cell, the validator accepted the
 * field, and the two layers in between named five columns each. The quote
 * minted at retail and the toast said "Items saved."
 */
describe("the draft rail carries a per-line trade price", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    retrievePartnerQuote.mockResolvedValue({
      id: "pq_1",
      status: "draft",
      partner_id: "pa_1",
      currency_code: "aud",
      destination_country_code: "au",
    })
    listPartnerQuoteLines.mockResolvedValue([])
  })

  it("PATCH stores a flat unit price as a typed override, not as metadata", async () => {
    await PATCH(
      makeReq({
        lines: [{ variant_id: "var_1", quantity: 500, override_unit_amount: 1200 }],
      }),
      makeRes()
    )

    const [row] = createPartnerQuoteLines.mock.calls[0][0]
    expect(row.override_kind).toBe("override_unit_amount")
    expect(row.override_input_amount).toBe(1200)
  })

  it("PATCH stores a discount percentage", async () => {
    await PATCH(
      makeReq({
        lines: [{ variant_id: "var_1", quantity: 500, discount_percent: 12.5 }],
      }),
      makeRes()
    )

    const [row] = createPartnerQuoteLines.mock.calls[0][0]
    expect(row.override_kind).toBe("discount_percent")
    expect(row.override_input_amount).toBe(12.5)
  })

  /**
   * 🔑 A typed weight is marked `manual` where it is stored, so it can never be
   * mistaken for a figure the catalogue answered.
   */
  it("PATCH stores an operator-typed weight with its provenance", async () => {
    await PATCH(
      makeReq({
        lines: [{ variant_id: "var_1", quantity: 20, unit_weight_grams: 115 }],
      }),
      makeRes()
    )

    const [row] = createPartnerQuoteLines.mock.calls[0][0]
    expect(row.quoted_unit_weight_grams).toBe(115)
    expect(row.quoted_weight_source).toBe("manual")
  })

  /**
   * 🔴 The items modal rebuilds its PRODUCT selection from `product_id`, and
   * the grid renders a row per variant of the selected products. Saved null, a
   * reopened draft shows an empty grid over a full basket — and a price cannot
   * be typed onto a row that does not render.
   */
  it("PATCH fills in the product a variant belongs to", async () => {
    graph.mockResolvedValueOnce({
      data: [{ id: "var_1", product: { id: "prod_1" } }],
    })

    await PATCH(
      makeReq({ lines: [{ variant_id: "var_1", quantity: 5 }] }),
      makeRes()
    )

    const [row] = createPartnerQuoteLines.mock.calls[0][0]
    expect(row.product_id).toBe("prod_1")
  })

  it("PATCH leaves an ordinary line's price columns null", async () => {
    await PATCH(
      makeReq({ lines: [{ variant_id: "var_1", quantity: 500 }] }),
      makeRes()
    )

    const [row] = createPartnerQuoteLines.mock.calls[0][0]
    expect(row.override_kind).toBeNull()
    expect(row.override_input_amount).toBeNull()
    expect(row.quoted_unit_weight_grams).toBeNull()
    expect(row.quoted_weight_source).toBeNull()
  })

  it("mints with the stored flat price, not at catalogue", async () => {
    listPartnerQuoteLines.mockResolvedValue([
      {
        id: "l1",
        variant_id: "var_1",
        quantity: 500,
        position: 0,
        override_kind: "override_unit_amount",
        override_input_amount: 1200,
        quoted_unit_weight_grams: 115,
      },
    ])

    await mintDraft(makeReq({}), makeRes())

    const body = mintQuote.mock.calls[0][0].validatedBody
    expect(body.lines[0].override_unit_amount).toBe(1200)
    expect(body.lines[0].unit_weight_grams).toBe(115)
    expect("discount_percent" in body.lines[0]).toBe(false)
  })

  it("mints with the stored discount", async () => {
    listPartnerQuoteLines.mockResolvedValue([
      {
        id: "l1",
        variant_id: "var_1",
        quantity: 500,
        position: 0,
        override_kind: "discount_percent",
        override_input_amount: "12.5",
      },
    ])

    await mintDraft(makeReq({}), makeRes())

    const body = mintQuote.mock.calls[0][0].validatedBody
    expect(body.lines[0].discount_percent).toBe(12.5)
    expect("override_unit_amount" in body.lines[0]).toBe(false)
  })

  /**
   * 🔴 `Number(null)` is `0`, and a `0` here is a flat price of zero — an
   * ACTIVE price the cart would cheerfully charge. An ordinary line must send
   * no price field at all.
   */
  it("sends no price field for a line that never had one", async () => {
    listPartnerQuoteLines.mockResolvedValue([
      {
        id: "l1",
        variant_id: "var_1",
        quantity: 500,
        position: 0,
        override_kind: null,
        override_input_amount: null,
        quoted_unit_weight_grams: null,
      },
    ])

    await mintDraft(makeReq({}), makeRes())

    const line = mintQuote.mock.calls[0][0].validatedBody.lines[0]
    expect("override_unit_amount" in line).toBe(false)
    expect("discount_percent" in line).toBe(false)
    expect("unit_weight_grams" in line).toBe(false)
  })
})

/**
 * "Which one wins" must not have an answer — and it must be refused where the
 * number is FIRST stored, not minutes later at the mint.
 */
describe("AdminUpdateQuoteDraftReq", () => {
  it("refuses a line carrying both a discount and a flat price", () => {
    const result = AdminUpdateQuoteDraftReq.safeParse({
      lines: [
        {
          variant_id: "var_1",
          quantity: 1,
          discount_percent: 10,
          override_unit_amount: 900,
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it("accepts either one alone", () => {
    for (const line of [
      { variant_id: "var_1", quantity: 1, discount_percent: 10 },
      { variant_id: "var_1", quantity: 1, override_unit_amount: 900 },
      { variant_id: "var_1", quantity: 1, unit_weight_grams: 115 },
    ]) {
      expect(AdminUpdateQuoteDraftReq.safeParse({ lines: [line] }).success).toBe(true)
    }
  })
})
