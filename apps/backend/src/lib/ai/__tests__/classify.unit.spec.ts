jest.mock("../typesafe", () => {
  const actual = jest.requireActual("../typesafe")
  return { ...actual, askSystemOne: jest.fn() }
})
jest.mock("../../../modules/socials/utils/token-helpers", () => ({
  decryptApiKey: (cfg: any) => cfg.api_key_encrypted ? `dec(${cfg.api_key_encrypted})` : cfg.api_key ?? null,
}))

import { askSystemOne } from "../typesafe"
import { classify, optionsFor, pickClassifierRow, resolveClassifier } from "../classify"

const ask = askSystemOne as jest.MockedFunction<typeof askSystemOne>

const row = (over: any = {}) => ({
  id: over.id ?? "plat_codiv",
  category: "ai",
  status: "active",
  base_url: null,
  api_config: { api_key_encrypted: "ct", ...(over.api_config ?? {}) },
  updated_at: over.updated_at ?? "2026-09-24T00:00:00Z",
  metadata: {
    role: "ai_classification",
    provider_type: "codiv",
    pre_classification: true,
    scopes: ["partner_capability_scan"],
    ...(over.metadata ?? {}),
  },
  ...(over.top ?? {}),
})

const containerWith = (rows: any[]) => ({
  resolve: (key: string) => {
    if (key === "socials") return { listSocialPlatforms: jest.fn(async () => rows) }
    throw new Error("no " + key)
  },
})

const OLD_ENV = { ...process.env }
afterEach(() => {
  process.env = { ...OLD_ENV }
  ask.mockReset()
})

describe("pickClassifierRow", () => {
  it("is OFF unless the row is switched on", () => {
    expect(pickClassifierRow([row({ metadata: { pre_classification: false } })], "partner_capability_scan")).toBeNull()
    expect(pickClassifierRow([row({ metadata: { pre_classification: undefined } })], "partner_capability_scan")).toBeNull()
  })

  it("serves only its scopes; an exact scope beats '*'", () => {
    const wild = row({ id: "wild", metadata: { scopes: ["*"], is_default: true } })
    const exact = row({ id: "exact", metadata: { scopes: ["partner_capability_scan"] } })
    expect(pickClassifierRow([wild, exact], "partner_capability_scan")?.id).toBe("exact")
    expect(pickClassifierRow([wild, exact], "tool_slice")?.id).toBe("wild")
    expect(pickClassifierRow([exact], "tool_slice")).toBeNull()
  })

  it("ignores inactive rows, other roles, and providers that are not System One", () => {
    expect(pickClassifierRow([row({ top: { status: "inactive" } })], "partner_capability_scan")).toBeNull()
    expect(pickClassifierRow([row({ metadata: { role: "ai_partner_website_scan" } })], "partner_capability_scan")).toBeNull()
    expect(pickClassifierRow([row({ metadata: { provider_type: "cloudflare" } })], "partner_capability_scan")).toBeNull()
  })

  it("accepts scopes typed as a comma list", () => {
    expect(pickClassifierRow([row({ metadata: { scopes: "tool_slice, partner_capability_scan" } })], "partner_capability_scan")).not.toBeNull()
  })
})

describe("resolveClassifier", () => {
  it("resolves Codiv's endpoint and model from the row, with the decrypted key", async () => {
    const c = await resolveClassifier(containerWith([row()]), "partner_capability_scan")
    expect(c).toEqual({
      provider: "codiv",
      url: "https://api.codiv.ai/v1/systemone",
      model: "openjev-latest",
      apiKey: "dec(ct)",
      options: { steps: 4 },
      maxQuestions: 9,
      platformId: "plat_codiv",
    })
  })

  it("honours base_url / default_model overrides on the row", async () => {
    const c = await resolveClassifier(
      containerWith([row({ api_config: { base_url: "https://eu.codiv.ai/v1/systemone", default_model: "openjev-0.1" } })]),
      "partner_capability_scan"
    )
    expect(c).toMatchObject({ url: "https://eu.codiv.ai/v1/systemone", model: "openjev-0.1" })
  })

  it("🔴 in production only a platform row can turn it on — the env key is ignored", async () => {
    process.env.TYPESAFE_API_KEY = "sk-env"
    process.env.NODE_ENV = "production"
    expect(await resolveClassifier(containerWith([]), "partner_capability_scan")).toBeNull()
    process.env.NODE_ENV = "development"
    expect(await resolveClassifier(containerWith([]), "partner_capability_scan")).toMatchObject({ provider: "typesafe", platformId: "env" })
  })
})

describe("failover", () => {
  it("🔴 moves to the next row serving the scope when the first does not answer", async () => {
    const codiv = row({ id: "codiv", metadata: { is_default: true } })
    const ts = row({ id: "ts", metadata: { provider_type: "typesafe" } })
    ask.mockResolvedValueOnce(null).mockResolvedValueOnce({ model: "jev-1.13.0", answers: { q: { type: "noul", noul: 1 } } } as any)
    const r = await classify(containerWith([ts, codiv]), { scope: "partner_capability_scan", state: {}, questions: { q: { type: "noul", instructions: "?" } } })
    expect(ask.mock.calls.map((c) => (c[1] as any).url)).toEqual(["https://api.codiv.ai/v1/systemone", "https://api.typesafe.ai/v1/systemone"])
    expect(r).toMatchObject({ provider: "typesafe", platformId: "ts" })
  })

  it("answers null when every row fails", async () => {
    ask.mockResolvedValue(null)
    expect(await classify(containerWith([row()]), { scope: "partner_capability_scan", state: {}, questions: {} })).toBeNull()
  })
})

describe("optionsFor", () => {
  it("🔴 Codiv defaults to steps 4 — one step was confidently wrong on real evidence", () => {
    expect(optionsFor("codiv", undefined)).toEqual({ steps: 4 })
  })
  it("takes a row's whitelisted integer options, and drops anything else", () => {
    expect(optionsFor("codiv", { steps: "8", samples: 2, temperature: 1, think: -1 })).toEqual({ steps: 8, samples: 2 })
    expect(optionsFor("typesafe", { steps: 4 })).toEqual({})
  })
})

describe("classify", () => {
  it("answers null — never throws — when nothing serves the scope", async () => {
    delete process.env.TYPESAFE_API_KEY
    expect(await classify(containerWith([]), { scope: "x", state: {}, questions: {} })).toBeNull()
    expect(ask).not.toHaveBeenCalled()
  })

  it("sends to the resolved provider and says which one answered", async () => {
    ask.mockResolvedValueOnce({ model: "openjev-0.1", answers: { q: { type: "noul", noul: 0.9 } } } as any)
    const r = await classify(containerWith([row()]), { scope: "partner_capability_scan", state: { a: 1 }, questions: { q: { type: "noul", instructions: "?" } } })
    expect(ask.mock.calls[0][1]).toMatchObject({ apiKey: "dec(ct)", url: "https://api.codiv.ai/v1/systemone", model: "openjev-latest", extra: { steps: 4 } })
    expect(r).toMatchObject({ provider: "codiv", platformId: "plat_codiv", answers: { q: { noul: 0.9 } } })
  })
})
