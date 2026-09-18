import {
  buildReminderFacts,
  proseLanguageFor,
} from "../whatsapp-reminder-prose"
import { buildOutreachPrompt } from "../whatsapp-outreach-prose"

describe("proseLanguageFor (#2130 — registration language → prose style)", () => {
  it("maps hi to hinglish, not Devanagari", () => {
    expect(proseLanguageFor("hi")).toBe("hinglish")
    expect(proseLanguageFor("hi-IN")).toBe("hinglish")
  })

  it("maps an explicit Devanagari code to devanagari", () => {
    expect(proseLanguageFor("hi_deva")).toBe("devanagari")
  })

  it("falls back to english for en, unknown and missing", () => {
    expect(proseLanguageFor("en")).toBe("english")
    expect(proseLanguageFor("fr")).toBe("english")
    expect(proseLanguageFor(null)).toBe("english")
    expect(proseLanguageFor(undefined)).toBe("english")
    expect(proseLanguageFor("  ")).toBe("english")
  })
})

describe("buildReminderFacts", () => {
  const base = {
    partner_name: "Sharlho",
    business_name: "Jaal Yantra Textiles",
    reminder_kind: "idle",
    design_name: "Alpha 60 Top",
    run_id: "prod_run_01M25XAZZM8BEKDSPHK5MT11G7",
    quantity: 1,
    age_label: "6 days",
    language_code: "hi",
  }

  it("carries the partner's registration language through as a style", () => {
    expect(buildReminderFacts(base).language).toBe("hinglish")
  })

  it("states the stage in words, not as a template kind", () => {
    const purpose = buildReminderFacts(base).purpose
    expect(purpose).toContain("no update")
    expect(purpose).not.toContain("idle")
    expect(purpose).not.toContain("reminder_kind")
  })

  it("never puts the run id in the message facts", () => {
    // A machine identifier in a human sentence is what made the old reminders
    // read like receipts. The deep-link button is how they reach the run.
    const facts = buildReminderFacts(base)
    const rendered = buildOutreachPrompt(facts)
    expect(rendered).not.toContain("prod_run_")
  })

  it("mentions a repeat only when it IS one", () => {
    expect(
      Object.keys(buildReminderFacts({ ...base, reminder_count: 0 }).details ?? {})
    ).not.toContain("times we have already asked")

    expect(
      Object.keys(buildReminderFacts({ ...base, reminder_count: 2 }).details ?? {})
    ).toContain("times we have already asked")
  })

  it("drops facts we do not have rather than inventing a placeholder", () => {
    const facts = buildReminderFacts({
      partner_name: "Sharlho",
      business_name: "Jaal Yantra Textiles",
      reminder_kind: "idle",
    })
    const prompt = buildOutreachPrompt(facts)
    // buildOutreachPrompt filters empty values, so nothing renders as
    // "undefined" or "null" in the text handed to the model.
    expect(prompt).not.toMatch(/: (undefined|null)\b/)
  })

  it("an unknown rule key still produces a usable purpose", () => {
    // #2122 makes rule keys free-form, so this WILL be reached by a rule that
    // predates no lookup entry. It must degrade, not blank out.
    const facts = buildReminderFacts({ ...base, reminder_kind: "no_consumption_5d" })
    expect(facts.purpose).toContain("update")
    expect(facts.purpose.length).toBeGreaterThan(20)
  })

  it("the prompt still forbids claiming to be a person", () => {
    const prompt = buildOutreachPrompt(buildReminderFacts(base))
    expect(prompt).toContain("Do NOT claim to be a named individual")
  })
})
