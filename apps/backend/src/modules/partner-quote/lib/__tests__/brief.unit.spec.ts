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

import { convertBriefMoney } from "../brief-view"
import { summariseBrief } from "../brief-crm"

describe("convertBriefMoney (#2608)", () => {
  it("converts every estimate figure and leaves nulls null", () => {
    const view = {
      currency_code: "inr",
      options: [{
        steps: [{ choices: [{ estimate: { low: 100, high: 200, setup_fee: null, currency_code: "inr" } }, { estimate: null }] }],
        estimate: { currency_code: "inr", per_piece_low: 100, per_piece_high: 200, setup_total: 0, total_low: null, total_high: null },
      }],
    }
    convertBriefMoney(view, 0.018, "aud")
    expect(view.currency_code).toBe("aud")
    expect(view.options[0].steps[0].choices[0].estimate).toMatchObject({ low: 1.8, high: 3.6, setup_fee: null, currency_code: "aud" })
    expect(view.options[0].steps[0].choices[1].estimate).toBeNull()
    expect(view.options[0].estimate).toMatchObject({ per_piece_low: 1.8, per_piece_high: 3.6, total_low: null, currency_code: "aud" })
  })
})

describe("file answers (#2608)", () => {
  const q = { key: "artwork", label: "Artwork", kind: "file" }
  const stored = [
    { url: "https://cdn/x/a.png", name: "a.png", type: "image/png", size: 1, uploaded_at: "t" },
    { url: "https://cdn/x/b.pdf", name: "b.pdf", type: "application/pdf", size: 1, uploaded_at: "t" },
  ]
  it("lets the buyer remove a file", () => {
    expect(validateBriefAnswer(q, [stored[1]], stored)).toEqual([stored[1]])
  })
  it("refuses a URL she typed: files are only added by uploading", () => {
    expect(() => validateBriefAnswer(q, ["https://evil.example/x.png"], stored)).toThrow(/uploading/)
  })
})

describe("summariseBrief (#2608)", () => {
  it("lists her picks, open steps and answers for the CRM note", () => {
    const text = summariseBrief({
      title: "Bags",
      recipient_name: "A buyer",
      options: [{
        title: "Hand-painted", buyer_selected: true,
        steps: [
          { label: "Fabric", state: "estimated", selected_choice_id: "c1", choices: [{ id: "c1", partner: { name: "GOF" } }] },
          { label: "Stitching", state: "ask", selected_choice_id: null, choices: [{ id: "c2", partner: { name: "Sharlho" } }, { id: "c3", partner: { name: "Shramdaan" } }] },
          { label: "Leather", state: "exploring", selected_choice_id: null, choices: [] },
        ],
        estimate: { currency_code: "aud", per_piece_low: 10, per_piece_high: 30, complete: false, quantity: 40, total_low: 400, total_high: 1200, pending_steps: ["Stitching"] },
      }, { title: "Not picked", buyer_selected: false, steps: [], estimate: {} }],
      questions: [{ label: "How many?", kind: "number", answer: 40 }],
    })
    expect(text).toContain("Hand-painted")
    expect(text).not.toContain("Not picked")
    expect(text).toContain("Fabric: GOF")
    expect(text).toContain("Stitching: open: Sharlho / Shramdaan")
    expect(text).toContain("Leather: no partner yet")
    expect(text).toContain("AUD 10–30/piece so far, 40 pcs 400–1200")
    expect(text).toContain("How many? 40")
  })
})
