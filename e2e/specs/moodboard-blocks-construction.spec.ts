import { test, expect, request as pwRequest } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * #1113 Feature A + B — insert-block palette and construction picker, end-to-end
 * against the live server.
 *
 * Pure HTTP (no browser), so it runs headless + on CI over :9000 alongside the
 * designer-invite flow. Reuses the same seeded design (a full brief, no tech-pack
 * data yet) and the real invite→accept path to obtain an assigned-designer
 * bearer, then exercises the new author-scoped routes:
 *   - GET/POST /partners/designs/:id/moodboard/blocks          (Feature A)
 *   - GET      /partners/designs/:id/construction-techniques   (Feature B)
 *   - GET/POST/DELETE /partners/designs/:id/construction-details (Feature B)
 * and proves the A↔B tie-in: adding a construction detail makes the construction
 * block build its glyph frame.
 */
test.describe("Moodboard insert blocks + construction (#1113 A/B)", () => {
  let seed: { email: string; password: string; inviteDesignId: string }
  let adminToken: string

  test.beforeAll(async ({ baseURL }) => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(`E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`)
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.inviteDesignId) {
      throw new Error("E2E seed missing inviteDesignId — re-run the seed.")
    }

    const api = await pwRequest.newContext({ baseURL })
    const res = await api.post("/auth/user/emailpass", {
      data: { email: seed.email, password: seed.password },
    })
    expect(res.ok()).toBeTruthy()
    adminToken = (await res.json()).token
    await api.dispose()
  })

  /** Mint an invite and accept it → a partner request context (assigned designer). */
  async function assignedDesignerContext(baseURL: string) {
    const admin = await pwRequest.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${adminToken}` },
    })
    const mintRes = await admin.post(
      `/admin/designs/${seed.inviteDesignId}/designer-invites`,
      { data: { inviter_name: "Studio JYT" } }
    )
    expect(mintRes.status()).toBe(201)
    const { token } = await mintRes.json()

    const pub = await pwRequest.newContext({ baseURL })
    const email = `e2e-blocks-${Date.now()}@jyt.test`
    const acceptRes = await pub.post(`/partners/designer-invites/${token}/accept`, {
      data: { name: "Ada Weaver", email, password: "supersecret123" },
    })
    expect(acceptRes.status()).toBe(201)
    const accept = await acceptRes.json()

    const partner = await pwRequest.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${accept.token}` },
    })
    await admin.dispose()
    await pub.dispose()
    return partner
  }

  test("insert palette lists + builds blocks; construction picker round-trips", async ({
    baseURL,
  }) => {
    const partner = await assignedDesignerContext(baseURL!)
    const designId = seed.inviteDesignId

    // ── Feature A — the palette ────────────────────────────────────────────
    const listRes = await partner.get(`/partners/designs/${designId}/moodboard/blocks`)
    expect(listRes.status()).toBe(200)
    const { blocks } = await listRes.json()
    const byKey: Record<string, any> = Object.fromEntries(
      blocks.map((b: any) => [b.key, b])
    )
    // The seeded brief backs the three brief blocks; scaffolds are always on;
    // tech-pack blocks with no data yet are unavailable.
    expect(byKey["brief-concept"].available).toBe(true)
    expect(byKey["workspace"].available).toBe(true)
    expect(byKey["construction"].available).toBe(false)

    // Build one brief block — a single frame carrying the round-trip customData.
    const blockRes = await partner.post(
      `/partners/designs/${designId}/moodboard/blocks`,
      { data: { block: "brief-concept" } }
    )
    expect(blockRes.status()).toBe(200)
    const { block } = await blockRes.json()
    const frames = block.elements.filter((e: any) => e.type === "frame")
    expect(frames).toHaveLength(1)
    expect(frames[0].name).toBe("Brief · Concept & Identity")
    const conceptRect = block.elements.find(
      (e: any) =>
        e.type === "rectangle" &&
        e.customData?.kind === "brief-field" &&
        e.customData?.field === "concept_theme"
    )
    expect(conceptRect).toBeTruthy()

    // Unknown block → 400.
    const badRes = await partner.post(
      `/partners/designs/${designId}/moodboard/blocks`,
      { data: { block: "does-not-exist" } }
    )
    expect(badRes.status()).toBe(400)

    // ── Feature B — the construction catalog + create ──────────────────────
    const catRes = await partner.get(
      `/partners/designs/${designId}/construction-techniques`
    )
    expect(catRes.status()).toBe(200)
    const catalog = await catRes.json()
    expect(Array.isArray(catalog.families)).toBe(true)
    const dart = catalog.techniques.find((t: any) => t.slug === "dart")
    expect(dart).toBeTruthy()
    expect(dart.params.some((p: any) => p.key === "intake")).toBe(true)

    // Add a construction detail (auto-fill defaults the picker would submit).
    const createRes = await partner.post(
      `/partners/designs/${designId}/construction-details`,
      {
        data: {
          technique: "dart",
          label: "Waist dart (e2e)",
          params: { intake: 0.6 },
          fabricRules: ["press toward centre front"],
        },
      }
    )
    expect(createRes.status()).toBe(201)
    const { construction_detail } = await createRes.json()
    expect(construction_detail.metadata.technique).toBe("dart")

    // ── The A↔B tie-in — construction block now builds its glyph ────────────
    const list2 = await (
      await partner.get(`/partners/designs/${designId}/moodboard/blocks`)
    ).json()
    const construction2 = list2.blocks.find((b: any) => b.key === "construction")
    expect(construction2.available).toBe(true)

    const consBlockRes = await partner.post(
      `/partners/designs/${designId}/moodboard/blocks`,
      { data: { block: "construction" } }
    )
    expect(consBlockRes.status()).toBe(200)
    const consBlock = await consBlockRes.json()
    const consFrame = consBlock.block.elements.find(
      (e: any) => e.type === "frame" && e.name === "4 · Construction details"
    )
    expect(consFrame).toBeTruthy()
    // The dart renders as native, editable line polylines.
    expect(consBlock.block.elements.some((e: any) => e.type === "line")).toBe(true)

    // ── List + delete the detail ───────────────────────────────────────────
    const detailsRes = await partner.get(
      `/partners/designs/${designId}/construction-details`
    )
    expect(detailsRes.status()).toBe(200)
    const { construction_details } = await detailsRes.json()
    const mine = construction_details.find(
      (d: any) => d.id === construction_detail.id
    )
    expect(mine).toBeTruthy()

    const delRes = await partner.delete(
      `/partners/designs/${designId}/construction-details/${construction_detail.id}`
    )
    expect(delRes.status()).toBe(200)
    expect((await delRes.json()).deleted).toBe(true)

    await partner.dispose()
  })
})
