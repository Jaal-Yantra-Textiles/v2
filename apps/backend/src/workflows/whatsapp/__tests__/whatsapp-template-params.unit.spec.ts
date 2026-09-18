import {
  sanitizeTemplateParam,
  sanitizeTemplateParams,
  TEMPLATE_PARAM_MAX_LENGTH,
} from "../whatsapp-template-params"
import {
  buildOutreachPrompt,
  fallbackOutreachText,
} from "../whatsapp-outreach-prose"

/**
 * The rule that decides whether a prose carrier template works at all.
 *
 * Meta rejects a body parameter containing a newline, a tab, or more than 4
 * consecutive spaces. Every template variable today is a name, an id or a
 * number, so the rule has never been reachable — and `send-whatsapp.ts` built
 * its parameters raw, with no cleaning and no cap. Prose reaches it on the
 * first send.
 *
 * 🔴 And per #1279, a rejected send used to still burn the reminder's cap,
 * which is how runs were parked having never been asked. A formatting bug here
 * does not look like a formatting bug downstream.
 */
describe("sanitizeTemplateParam", () => {
  it("🔴 collapses the newlines that generated prose always contains", () => {
    const r = sanitizeTemplateParam("Hi Kiyo,\n\nYour pashmina arrived.\nLet us know.")
    expect(r.text).toBe("Hi Kiyo, Your pashmina arrived. Let us know.")
    expect(r.text).not.toMatch(/[\n\r]/)
    expect(r.changed).toBe(true)
  })

  it("🔴 collapses tabs — a design name pasted from a spreadsheet carries them", () => {
    expect(sanitizeTemplateParam("Pashmina\tTunic").text).toBe("Pashmina Tunic")
  })

  it("🔴 collapses a run of more than 4 spaces", () => {
    expect(sanitizeTemplateParam("Kiyo      Designs").text).toBe("Kiyo Designs")
  })

  it("collapses a carriage return, which a Windows paste brings along", () => {
    expect(sanitizeTemplateParam("one\r\ntwo").text).toBe("one two")
  })

  it("strips zero-width and bidi controls rather than sending mojibake", () => {
    const r = sanitizeTemplateParam("Kiyo​Designs﻿")
    expect(r.text).toBe("KiyoDesigns")
    expect(r.changed).toBe(true)
  })

  it("strips U+2028/U+2029, which are line terminators that are not \\s in every engine", () => {
    expect(sanitizeTemplateParam("a b c").text).toBe("abc")
  })

  it("leaves an already-clean value untouched and says so", () => {
    const r = sanitizeTemplateParam("Ksaman Naturals Pvt Ltd")
    expect(r.text).toBe("Ksaman Naturals Pvt Ltd")
    expect(r.changed).toBe(false)
    expect(r.truncated).toBe(false)
  })

  it("trims the edges", () => {
    expect(sanitizeTemplateParam("  padded  ").text).toBe("padded")
  })

  it("🔴 never returns empty for a non-empty input — an empty param fails the whole send", () => {
    // Meta answers an empty body parameter with a parameter-count mismatch, so
    // "this value was all whitespace" would present as "this template is broken".
    const r = sanitizeTemplateParam("   \n\t  ")
    expect(r.text).toBe("—")
    expect(r.text.length).toBeGreaterThan(0)
    expect(r.changed).toBe(true)
  })

  it("passes a genuinely empty input through as empty", () => {
    // Distinct from the case above: nothing was supplied, so nothing is lost by
    // saying so, and the caller's own length check still sees it.
    expect(sanitizeTemplateParam("").text).toBe("")
  })

  it("coerces non-strings instead of throwing", () => {
    expect(sanitizeTemplateParam(42).text).toBe("42")
    expect(sanitizeTemplateParam(null).text).toBe("")
    expect(sanitizeTemplateParam(undefined).text).toBe("")
  })

  it("caps an over-long value and marks it truncated", () => {
    const long = "word ".repeat(400)
    const r = sanitizeTemplateParam(long)
    expect(r.text.length).toBeLessThanOrEqual(TEMPLATE_PARAM_MAX_LENGTH)
    expect(r.truncated).toBe(true)
    expect(r.text.endsWith("…")).toBe(true)
  })

  it("cuts on a word boundary rather than mid-word", () => {
    const long = "word ".repeat(400)
    const r = sanitizeTemplateParam(long)
    expect(r.text).not.toMatch(/wor…$/)
  })

  it("falls back to a hard cut when there is no nearby space", () => {
    const r = sanitizeTemplateParam("x".repeat(900))
    expect(r.text.length).toBeLessThanOrEqual(TEMPLATE_PARAM_MAX_LENGTH)
    expect(r.truncated).toBe(true)
  })

  it("leaves a value exactly at the limit alone", () => {
    const exact = "x".repeat(TEMPLATE_PARAM_MAX_LENGTH)
    const r = sanitizeTemplateParam(exact)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe(exact)
  })
})

describe("sanitizeTemplateParams", () => {
  it("reports WHICH parameters were altered, so a short message is explainable", () => {
    const r = sanitizeTemplateParams(["clean", "has\nnewline", "also clean"])
    expect(r.texts).toEqual(["clean", "has newline", "also clean"])
    expect(r.changedIndexes).toEqual([1])
    expect(r.truncatedIndexes).toEqual([])
  })

  it("reports truncation separately from cleaning — the reader lost words", () => {
    const r = sanitizeTemplateParams(["ok", "word ".repeat(400)])
    expect(r.changedIndexes).toContain(1)
    expect(r.truncatedIndexes).toEqual([1])
  })

  it("preserves parameter COUNT and ORDER — Meta matches them positionally", () => {
    const r = sanitizeTemplateParams(["a", "   ", "c", null])
    expect(r.texts).toHaveLength(4)
    expect(r.texts[0]).toBe("a")
    expect(r.texts[2]).toBe("c")
  })
})

/**
 * The outreach prose itself.
 *
 * 🔴 These pin the honesty constraints as hard as the formatting ones. The
 * message should read like a person wrote it. It must not claim to BE a person:
 * partners accept work and invoice against these messages, and a counterparty
 * who thinks they are talking to a human commits differently. It is also
 * against WhatsApp's Business Messaging Policy, and the penalty lands on the
 * template — which, with one prose carrier, is every message we send.
 */
describe("buildOutreachPrompt", () => {
  const facts = {
    partner_name: "Ksaman Naturals Pvt Ltd",
    business_name: "JYT Textiles",
    purpose: "Introduce ourselves and invite them to reply.",
  }

  it("🔴 forbids claiming to be a named individual", () => {
    const p = buildOutreachPrompt(facts)
    expect(p).toMatch(/Do NOT claim to be a named individual/)
    expect(p).toMatch(/do not invent a staff member/)
  })

  it("🔴 forbids inventing facts the partner would act on", () => {
    const p = buildOutreachPrompt(facts)
    expect(p).toMatch(/Do not invent quantities, dates, prices/)
    expect(p).toMatch(/no delivery dates, no payment dates, no rates/)
  })

  it("asks for a human voice, not a template voice", () => {
    const p = buildOutreachPrompt(facts)
    expect(p).toMatch(/Write like a person would/)
    expect(p).toMatch(/No template voice/)
  })

  it("forbids the line breaks that Meta would reject anyway", () => {
    expect(buildOutreachPrompt(facts)).toMatch(/No line breaks/)
  })

  it("passes only the facts it was given, and drops empty ones", () => {
    const p = buildOutreachPrompt({
      ...facts,
      details: { design: "Pashmina Tunic", quantity: 2, missing: "", nothing: null },
    })
    expect(p).toContain("design: Pashmina Tunic")
    expect(p).toContain("quantity: 2")
    expect(p).not.toContain("missing:")
    expect(p).not.toContain("nothing:")
  })

  it("matches the partner's language", () => {
    expect(buildOutreachPrompt({ ...facts, language: "hinglish" })).toMatch(/Hinglish/)
    expect(buildOutreachPrompt({ ...facts, language: "devanagari" })).toMatch(/Devanagari/)
    expect(buildOutreachPrompt({ ...facts, language: "english" })).toMatch(/plain English/)
  })

  it("defaults to English for an unknown language rather than omitting the instruction", () => {
    expect(buildOutreachPrompt({ ...facts, language: "klingon" })).toMatch(/plain English/)
  })
})

describe("fallbackOutreachText", () => {
  it("is always sendable — a missing model must not stop first contact", () => {
    const t = fallbackOutreachText({
      partner_name: "Ksaman Naturals Pvt Ltd",
      business_name: "JYT Textiles",
      purpose: "Introduce ourselves and invite them to reply.",
    })
    expect(t.length).toBeGreaterThan(0)
    expect(t).toContain("Ksaman Naturals Pvt Ltd")
    expect(t).toContain("JYT Textiles")
  })

  it("is itself safe to pass as a template parameter", () => {
    const t = fallbackOutreachText({
      partner_name: "Ksaman\nNaturals",
      business_name: "JYT Textiles",
      purpose: "Hello.\n\nReply here.",
    })
    expect(t).not.toMatch(/[\n\r\t]/)
  })

  it("names the business, never a person", () => {
    const t = fallbackOutreachText({
      partner_name: "P",
      business_name: "JYT Textiles",
      purpose: "x",
    })
    expect(t).toMatch(/this is JYT Textiles/)
  })
})
