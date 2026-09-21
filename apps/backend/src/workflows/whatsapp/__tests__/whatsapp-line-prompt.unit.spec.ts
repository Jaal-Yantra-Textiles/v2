/**
 * #2216 — the rules that make a generated WhatsApp reply safe to send.
 *
 * The regression these guard is not "the wording got worse". It is a partner
 * receiving a sentence containing `prod_run_01M22Y…` that is one character
 * wrong: it looks right, refers to nothing, and nothing downstream can tell it
 * from a real id. Everything here fails CLOSED — the caller then sends the
 * English constant it already had, which is merely plain.
 */
import {
  allowedNumbersFrom,
  buildLineUserPrompt,
  composeLine,
  containsInventedId,
  containsUnknownNumber,
  isLineUsable,
  LINE_MAX_CHARS,
} from "../whatsapp-line-prompt"

describe("isLineUsable", () => {
  it("accepts an ordinary sentence", () => {
    expect(isLineUsable("Thanks — we have your photo.")).toBe(true)
  })

  it.each([
    ["a run id", "Attached to prod_run_01M22YXTZKQXBSD23MZAQBVRTE."],
    ["an inventory order id", "Waiting on inv_order_01M232123QP7WD4E7NBSNZWJHM."],
    ["an order line id", "See ordli_01KNP520PWJAES0MWCD6HCW4XC."],
  ])("refuses a reply carrying %s the model was never given", (_label, text) => {
    expect(containsInventedId(text)).toBe(true)
    expect(isLineUsable(text)).toBe(false)
  })

  it("refuses a number the facts do not contain — quantities decide money", () => {
    expect(isLineUsable("You made 20 pieces.", [2])).toBe(false)
  })

  it("accepts a number the facts DO contain", () => {
    expect(isLineUsable("You made 2 pieces.", [2])).toBe(true)
  })

  it("leaves digits inside a word alone — an ordinal is not a quantity", () => {
    expect(containsUnknownNumber("Send it by the 2nd batch.", [])).toBe(false)
  })

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["not a string", 42],
    ["an essay", "x".repeat(LINE_MAX_CHARS + 1)],
  ])("refuses %s", (_label, value) => {
    expect(isLineUsable(value as any)).toBe(false)
  })
})

describe("allowedNumbersFrom", () => {
  it("takes numbers from numeric facts", () => {
    expect(allowedNumbersFrom([{ label: "Pieces", value: 3 }])).toEqual(["3"])
  })

  /*
   * A fact can be a phrase — "Window: 10 minutes" — and the model is entitled
   * to repeat a number it was actually shown. Without this the fact itself
   * would get the reply rejected, and every such message would silently serve
   * the English constant forever.
   */
  it("takes numbers out of a textual fact too", () => {
    expect(
      allowedNumbersFrom([{ label: "Window", value: "10 minutes" }])
    ).toEqual(["10"])
  })

  it("survives a fact with no digits at all", () => {
    expect(allowedNumbersFrom([{ label: "Design", value: "Oshen — Shawls" }])).toEqual([])
  })
})

describe("buildLineUserPrompt", () => {
  /*
   * 🔴 The identifier is withheld by CONSTRUCTION, not by instruction. There is
   * no field on a spec that carries an id into the prompt — `tail` is appended
   * after the model has answered — so there is no path by which a hallucinated
   * id can be a paraphrase of a real one.
   */
  it("never puts an id in front of the model", () => {
    const prompt = buildLineUserPrompt({
      brief: "They finished the job.",
      facts: [{ label: "Design", value: "Pashmina Inspired Tunic" }],
      tail: "*Run:* prod_run_01M22YXTZKQXBSD23MZAQBVRTE",
      fallback: "done",
    })

    expect(prompt).toContain("Pashmina Inspired Tunic")
    expect(prompt).not.toContain("prod_run_")
  })
})

describe("composeLine", () => {
  it("appends the tail the caller wrote, verbatim", () => {
    expect(composeLine("  Thanks.  ", "*Run:* prod_run_1")).toBe(
      "Thanks.\n\n*Run:* prod_run_1"
    )
  })

  it("sends the sentence alone when there is nothing to append", () => {
    expect(composeLine("Thanks.")).toBe("Thanks.")
  })
})
