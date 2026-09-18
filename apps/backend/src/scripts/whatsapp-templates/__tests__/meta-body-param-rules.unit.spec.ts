import { PARTNER_RUN_TEMPLATES } from "../partner-run-templates"

/**
 * Meta's body-parameter placement rules, checked at build time instead of at
 * submission time.
 *
 * 🔴 Why this file exists. `jyt_partner_message_v1` — the prose carrier the
 * whole free-form reminder plan depends on — was written with its body as
 *
 *     "{{1}}\n\nReply to this message and we'll pick it up from here."
 *
 * and was therefore UNAPPROVABLE from the day it was added:
 *
 *     code=100 subcode=2388299 "Leading or trailing params not allowed —
 *     Variables can't be at the start or end of the template."
 *
 * Nobody knew for weeks, because it had never been submitted. A spec is not an
 * approval — and an unsubmitted spec is not even a rejection. It sat looking
 * finished, was cited as the blocker on a roadmap item, and the first real
 * submission (2026-09-18) failed all three variants across both WABAs at once.
 *
 * The rule is cheap to check and impossible to notice by reading, which is
 * exactly the kind of thing that belongs in a test rather than in a comment.
 * It runs over EVERY template, not just the carrier, so the next one written
 * this way fails here instead of in Meta's queue.
 */

/** Meta placeholders are `{{1}}`, `{{2}}`, … */
const PLACEHOLDER = /\{\{\s*\d+\s*\}\}/g

describe("Meta body-parameter rules (all partner-run templates)", () => {
  const variants = PARTNER_RUN_TEMPLATES.flatMap((t) =>
    (t.languages ?? []).map((l: any) => ({
      id: `${t.name}:${l.language}`,
      body: String(l.body ?? ""),
    }))
  )

  it("has templates to check (a zero-length sweep would pass vacuously)", () => {
    expect(variants.length).toBeGreaterThan(10)
  })

  it.each(variants.map((v) => [v.id, v.body]))(
    "%s does not START with a placeholder",
    (_id, body) => {
      expect(String(body).trimStart()).not.toMatch(/^\{\{\s*\d+\s*\}\}/)
    }
  )

  it.each(variants.map((v) => [v.id, v.body]))(
    "%s does not END with a placeholder",
    (_id, body) => {
      expect(String(body).trimEnd()).not.toMatch(/\{\{\s*\d+\s*\}\}$/)
    }
  )

  it.each(variants.map((v) => [v.id, v.body]))(
    "%s is not made ONLY of placeholders and whitespace",
    (_id, body) => {
      const withoutParams = String(body).replace(PLACEHOLDER, "").trim()
      expect(withoutParams.length).toBeGreaterThan(0)
    }
  )

  it("the prose carrier still carries exactly one free-text variable", () => {
    // The carrier's whole premise: one approval, and the message goes in the
    // variable. A second variable would mean a new `vars: [...]` tuple and a
    // new Meta review for every new thing we want to say — the shape it exists
    // to escape.
    const carrier = PARTNER_RUN_TEMPLATES.find(
      (t) => t.name === "jyt_partner_message_v1"
    )
    expect(carrier).toBeDefined()

    for (const lang of carrier!.languages ?? []) {
      const found = String((lang as any).body).match(PLACEHOLDER) ?? []
      expect(found).toEqual(["{{1}}"])
    }
  })
})
