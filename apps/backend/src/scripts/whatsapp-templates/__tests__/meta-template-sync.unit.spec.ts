import {
  planTemplateActions,
  buildComponents,
  type PlatformPlan,
  type MetaTemplate,
} from "../meta-template-sync"
import type { TemplateSpec, TemplateLanguageVariant } from "../partner-run-templates"

const platform = (id: string, languages: string[]): PlatformPlan => ({
  platformId: id,
  label: `Platform ${id}`,
  wabaId: `waba_${id}`,
  languages,
  accessToken: "tok",
})

const spec = (name: string, langs: string[]): TemplateSpec => ({
  name,
  category: "UTILITY",
  languages: langs.map((l) => ({ language: l, body: "hi {{1}}", examples: ["x"] })),
})

const existing = (name: string, language: string): MetaTemplate => ({
  id: `tpl_${name}_${language}`,
  name,
  language,
  status: "APPROVED",
})

describe("planTemplateActions", () => {
  it("marks missing variants create, present variants exists, off-policy langs lang-skipped", () => {
    const platforms = [platform("p1", ["en", "hi"]), platform("p2", ["en"])]
    const templates = [spec("t1", ["en", "hi"])]
    const existingByPlatformId = {
      p1: [existing("t1", "en")], // p1 has en, missing hi
      p2: [], // p2 has nothing
    }

    const actions = planTemplateActions(platforms, templates, existingByPlatformId)
    const key = (a: any) => `${a.platformId}:${a.name}:${a.language}:${a.kind}`
    const keys = actions.map(key)

    expect(keys).toContain("p1:t1:en:exists")
    expect(keys).toContain("p1:t1:hi:create")
    expect(keys).toContain("p2:t1:en:create")
    // p2 doesn't allow hi → lang-skipped, never create.
    expect(keys).toContain("p2:t1:hi:lang-skipped")
    expect(keys).not.toContain("p2:t1:hi:create")
  })

  it("carries the existing status through for exists actions", () => {
    const actions = planTemplateActions(
      [platform("p1", ["en"])],
      [spec("t1", ["en"])],
      { p1: [{ ...existing("t1", "en"), status: "PENDING" }] }
    )
    const a = actions.find((x) => x.kind === "exists")!
    expect(a.existingStatus).toBe("PENDING")
  })

  it("treats a platform with no existing list as all-create", () => {
    const actions = planTemplateActions(
      [platform("p1", ["en"])],
      [spec("t1", ["en"]), spec("t2", ["en"])],
      {} // no entry for p1
    )
    expect(actions.every((a) => a.kind === "create")).toBe(true)
    expect(actions.length).toBe(2)
  })
})

describe("buildComponents — button emission", () => {
  const base = (buttons?: TemplateLanguageVariant["buttons"]): TemplateLanguageVariant => ({
    language: "en",
    body: "hi {{1}}",
    examples: ["x"],
    buttons,
  })

  it("emits a dynamic URL button WITH its example (Meta requires it for {{1}} urls)", () => {
    const comps = buildComponents(
      base([
        {
          type: "URL",
          text: "Review request",
          url: "https://partner.jaalyantra.com/production-runs?wa_token={{1}}",
          example: ["https://partner.jaalyantra.com/production-runs?wa_token=eyJ.sample.sig"],
        },
      ])
    )
    const buttonsComp = comps.find((c) => c.type === "BUTTONS")
    expect(buttonsComp).toBeDefined()
    const btn = buttonsComp.buttons[0]
    expect(btn).toMatchObject({
      type: "URL",
      text: "Review request",
      url: "https://partner.jaalyantra.com/production-runs?wa_token={{1}}",
      example: ["https://partner.jaalyantra.com/production-runs?wa_token=eyJ.sample.sig"],
    })
  })

  it("omits `example` for a static URL button (no variable)", () => {
    const comps = buildComponents(
      base([{ type: "URL", text: "Open", url: "https://partner.jaalyantra.com/help" }])
    )
    const btn = comps.find((c) => c.type === "BUTTONS").buttons[0]
    expect(btn.example).toBeUndefined()
    expect(btn).toMatchObject({ type: "URL", text: "Open", url: "https://partner.jaalyantra.com/help" })
  })

  it("emits QUICK_REPLY buttons without url/example fields", () => {
    const comps = buildComponents(base([{ type: "QUICK_REPLY", text: "Accept" }]))
    const btn = comps.find((c) => c.type === "BUTTONS").buttons[0]
    expect(btn).toEqual({ type: "QUICK_REPLY", text: "Accept" })
  })

  it("emits no BUTTONS component when the variant has none", () => {
    const comps = buildComponents(base())
    expect(comps.find((c) => c.type === "BUTTONS")).toBeUndefined()
  })
})
