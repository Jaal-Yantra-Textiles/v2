import { estimateChoice, estimateOption } from "../brief-view"
import { missingRequired, validateBriefAnswer } from "../brief-answers"

const rate = (over: Partial<any> = {}) => ({
  id: "r",
  unit: "metre",
  currency_code: "inr",
  price_low: 150,
  price_high: null,
  setup_fee: null,
  min_qty: null,
  max_qty: null,
  lead_days: null,
  status: "confirmed",
  observed_at: new Date().toISOString(),
  ...over,
})

describe("estimateChoice (#2608)", () => {
  it("scales a per-metre fabric rate by the metres one piece uses", () => {
    const e = estimateChoice(rate(), 0.8)!
    expect(e.low).toBe(120)
    expect(e.high).toBe(120)
  })
  it("uses one unit per piece when qty_per_piece is not set", () => {
    expect(estimateChoice(rate({ unit: "piece", price_low: 500, price_high: 1500 }), null)).toMatchObject({ low: 500, high: 1500 })
  })
  it("has no estimate without a rate (we'll confirm), never 0", () => {
    expect(estimateChoice(null, 1)).toBeNull()
  })
  it("flags a proposed rate as unconfirmed", () => {
    expect(estimateChoice(rate({ status: "proposed" }), 1)!.rate_confirmed).toBe(false)
  })
})

describe("estimateOption (#2608)", () => {
  const fabric = { label: "Fabric", selected_choice_id: null, choices: [
    { id: "gof", estimate: estimateChoice(rate({ price_low: 150 }), 0.8) },
    { id: "wfs", estimate: estimateChoice(rate({ price_low: 281.82 }), 0.8) },
  ] }
  const paint = { label: "Hand painting", selected_choice_id: null, choices: [
    { id: "akshit", estimate: estimateChoice(rate({ unit: "piece", price_low: 500, price_high: 1500, setup_fee: 1000 }), null) },
  ] }
  const stitch = { label: "Stitching", selected_choice_id: null, choices: [{ id: "shramdaan", estimate: null }] }
  const leather = { label: "Leather work", selected_choice_id: null, choices: [] }

  it("ranges across partners until the buyer picks, and lists the steps still to confirm", () => {
    const e = estimateOption([fabric, paint, stitch, leather], "inr", null)
    expect(e.per_piece_low).toBe(120 + 500)
    expect(e.per_piece_high).toBe(225.46 + 1500)
    expect(e.pending_steps).toEqual(["Stitching", "Leather work"])
    expect(e.complete).toBe(false)
    expect(e.total_low).toBeNull()
  })
  it("uses the buyer's pick and adds setup once to the total for her quantity", () => {
    const e = estimateOption([{ ...fabric, selected_choice_id: "gof" }, paint], "inr", 4)
    expect(e.per_piece_low).toBe(620)
    expect(e.per_piece_high).toBe(1620)
    expect(e.total_low).toBe(620 * 4 + 1000)
    expect(e.total_high).toBe(1620 * 4 + 1000)
    expect(e.complete).toBe(true)
  })
  it("leaves a rate in another currency out instead of converting it", () => {
    const usd = { label: "Print", selected_choice_id: null, choices: [{ id: "x", estimate: estimateChoice(rate({ currency_code: "usd" }), 1) }] }
    const e = estimateOption([usd], "inr", null)
    expect(e.pending_steps).toEqual(["Print"])
    expect(e.skipped_currency).toEqual(["usd"])
  })
})

describe("validateBriefAnswer (#2608)", () => {
  const q = (kind: string, options?: string[]) => ({ key: "k", label: "Q", kind, options })
  it("accepts and refuses by kind", () => {
    expect(validateBriefAnswer(q("number"), "4")).toBe(4)
    expect(() => validateBriefAnswer(q("number"), "four")).toThrow(/number/)
    expect(validateBriefAnswer(q("choice", ["Leather", "Non-leather"]), "Leather")).toBe("Leather")
    expect(() => validateBriefAnswer(q("choice", ["Leather"]), "Vinyl")).toThrow(/pick one/)
    expect(validateBriefAnswer(q("multi_choice", ["Front", "Back"]), ["Front", "Front"])).toEqual(["Front"])
    expect(() => validateBriefAnswer(q("link"), "javascript:alert(1)")).toThrow()
    expect(validateBriefAnswer(q("date"), "2027-02-01")).toBe("2027-02-01")
    expect(validateBriefAnswer(q("text"), "")).toBeNull()
  })
  it("lists unanswered required questions", () => {
    expect(missingRequired([{ key: "quantity", label: "How many?", kind: "number", required: true, answer: null }])).toEqual(["How many?"])
  })
})
