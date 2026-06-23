import {
  buildNewsletterPrompt,
  parseNewsletterPayload,
  coerceNewsletterPayload,
  generateNewsletterDraft,
  NEWSLETTER_VOICE_RULES,
} from "../generate-newsletter-draft"

/**
 * #659 §12.4 — unit tests for the AI newsletter draft generator. The LLM call is
 * INJECTED as a stub so CI never calls a live model; the marketing module is a
 * tiny in-memory stub so no DB boots. Covers prompt assembly, tolerant JSON
 * parsing (incl. fenced + malformed fallback), payload coercion, and the
 * draft-vs-ready persist contract.
 */

describe("buildNewsletterPrompt", () => {
  it("embeds the topic, business, date, and voice rules", () => {
    const p = buildNewsletterPrompt({
      topic: "spring linen collection",
      businessDescription: "ACME textiles",
      dateIst: "2026-06-23",
    })
    expect(p).toContain("spring linen collection")
    expect(p).toContain("ACME textiles")
    expect(p).toContain("2026-06-23")
    expect(p).toContain('"subject"')
    expect(p).toContain(NEWSLETTER_VOICE_RULES.split("\n")[0])
  })

  it("falls back to an evergreen-angle instruction when no topic is given", () => {
    const p = buildNewsletterPrompt({ dateIst: "2026-06-23" })
    expect(p).toContain("evergreen angle")
  })
})

describe("coerceNewsletterPayload", () => {
  it("normalises section variants and drops empty sections", () => {
    const out = coerceNewsletterPayload({
      subject: " Hi ",
      preview: "peek",
      introduction: "welcome",
      sections: [
        { title: "A", content: "body a" },
        { heading: "B", text: "body b" },
        { heading: "", body: "" },
        "junk",
      ],
      call_to_action: "Shop now",
    })
    expect(out.subject).toBe("Hi")
    expect(out.preheader).toBe("peek")
    expect(out.intro).toBe("welcome")
    expect(out.cta).toBe("Shop now")
    expect(out.sections).toEqual([
      { heading: "A", body: "body a" },
      { heading: "B", body: "body b" },
    ])
  })

  it("is total on garbage input", () => {
    const out = coerceNewsletterPayload(null)
    expect(out).toEqual({
      subject: "",
      preheader: "",
      intro: "",
      sections: [],
      cta: "",
    })
  })
})

describe("parseNewsletterPayload", () => {
  it("parses a clean JSON object", () => {
    const out = parseNewsletterPayload(
      JSON.stringify({
        subject: "S",
        preheader: "P",
        intro: "I",
        sections: [{ heading: "H", body: "B" }],
        cta: "C",
      })
    )
    expect(out.parse_error).toBeUndefined()
    expect(out.subject).toBe("S")
    expect(out.sections).toHaveLength(1)
  })

  it("strips ```json fences and surrounding prose", () => {
    const raw =
      'Here you go:\n```json\n{"subject":"S","intro":"I","sections":[{"heading":"H","body":"B"}],"cta":"C","preheader":"P"}\n```\nThanks!'
    const out = parseNewsletterPayload(raw)
    expect(out.parse_error).toBeUndefined()
    expect(out.subject).toBe("S")
    expect(out.cta).toBe("C")
  })

  it("falls back to a single raw section on malformed output", () => {
    const out = parseNewsletterPayload("not json at all { broken")
    expect(out.parse_error).toBe(true)
    expect(out.sections).toHaveLength(1)
    expect(out.sections[0].body).toContain("not json")
  })

  it("flags empty input as a parse error", () => {
    const out = parseNewsletterPayload("")
    expect(out.parse_error).toBe(true)
    expect(out.sections).toHaveLength(0)
  })

  it("treats a parsed-but-empty object as a soft failure", () => {
    const out = parseNewsletterPayload(JSON.stringify({ foo: "bar" }))
    expect(out.parse_error).toBe(true)
  })
})

describe("generateNewsletterDraft", () => {
  const makeContainer = () => {
    const created: any[] = []
    const container: any = {
      resolve: () => ({
        createMarketingDrafts: async (rows: any[]) => {
          const withIds = rows.map((r, i) => ({ id: `draft_${i + 1}`, ...r }))
          created.push(...withIds)
          return withIds
        },
      }),
    }
    return { container, created }
  }

  const goodJson = JSON.stringify({
    subject: "S",
    preheader: "P",
    intro: "I",
    sections: [{ heading: "H", body: "B" }],
    cta: "C",
  })

  it("persists status=draft when markReady is false (dry-run path)", async () => {
    const { container, created } = makeContainer()
    const result = await generateNewsletterDraft(container, {
      aiGenerate: async () => goodJson,
      topic: "x",
      now: new Date("2026-06-23T00:00:00.000Z"),
      markReady: false,
    })
    expect(result.generated).toBe(true)
    expect(result.draft_id).toBe("draft_1")
    expect(result.status).toBe("draft")
    expect(result.name).toBe("newsletter-2026-06-23")
    expect(result.parse_error).toBe(false)
    expect(created[0].kind).toBe("newsletter")
    expect(created[0].status).toBe("draft")
    expect(created[0].approved_by).toBeNull()
  })

  it("persists status=approved + approved_by when markReady is true (apply path)", async () => {
    const { container, created } = makeContainer()
    const result = await generateNewsletterDraft(container, {
      aiGenerate: async () => goodJson,
      name: "custom-name",
      markReady: true,
    })
    expect(result.status).toBe("approved")
    expect(result.name).toBe("custom-name")
    expect(created[0].status).toBe("approved")
    expect(created[0].approved_by).toBe(
      "ops:generate-marketing-newsletter-draft"
    )
  })

  it("still persists (with parse_error) when the model returns junk", async () => {
    const { container, created } = makeContainer()
    const result = await generateNewsletterDraft(container, {
      aiGenerate: async () => "totally not json",
      markReady: false,
    })
    expect(result.generated).toBe(true)
    expect(result.parse_error).toBe(true)
    expect(created).toHaveLength(1)
    expect(created[0].payload.parse_error).toBe(true)
  })
})
