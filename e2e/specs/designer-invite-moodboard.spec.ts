import { test, expect, request as pwRequest } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * #1113 S1+S2 — designer onboarding, end-to-end against the live server.
 *
 * Exercises the real HTTP flow the founder asked for: a brand assembles a brief,
 * mints a scoped invite, a stranger accepts (becoming an assigned `designer`
 * partner without a portal login), and that partner generates the moodboard —
 * getting the brief rendered as the three anchor "cards" frames. Uses the API
 * request context (no browser UI needed) so it runs headless + on CI.
 */
test.describe("Designer invite → brief moodboard (#1113)", () => {
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

    // Admin bearer via the emailpass auth route (same creds the seed wrote).
    const api = await pwRequest.newContext({ baseURL })
    const res = await api.post("/auth/user/emailpass", {
      data: { email: seed.email, password: seed.password },
    })
    expect(res.ok()).toBeTruthy()
    adminToken = (await res.json()).token
    await api.dispose()
  })

  test("mint invite → stranger accepts → assigned designer generates the brief moodboard", async ({
    baseURL,
  }) => {
    const admin = await pwRequest.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${adminToken}` },
    })
    const pub = await pwRequest.newContext({ baseURL })

    // 1. Brand mints a scoped invite for the briefed design.
    const mintRes = await admin.post(
      `/admin/designs/${seed.inviteDesignId}/designer-invites`,
      { data: { inviter_name: "Studio JYT" } }
    )
    expect(mintRes.status()).toBe(201)
    const mint = await mintRes.json()
    expect(mint.token).toBeTruthy()

    // 2. Recipient lands on the read-only brief (token-as-auth, no session).
    const infoRes = await pub.get(`/partners/designer-invites/${mint.token}`)
    expect(infoRes.status()).toBe(200)
    const info = await infoRes.json()
    expect(info.invite.usable).toBe(true)
    expect(info.design.id).toBe(seed.inviteDesignId)
    expect(info.design.name).toContain("Designer Invite Brief")

    // 3. Stranger accepts → becomes a `designer` partner + gets a session bearer.
    const email = `e2e-designer-${Date.now()}@jyt.test`
    const acceptRes = await pub.post(
      `/partners/designer-invites/${mint.token}/accept`,
      { data: { name: "Ada Weaver", email, password: "supersecret123" } }
    )
    expect(acceptRes.status()).toBe(201)
    const accept = await acceptRes.json()
    expect(accept.token).toBeTruthy()
    expect(accept.redirect).toBe(`/designs/${seed.inviteDesignId}/moodboard`)

    // 4. The assigned designer generates the moodboard — no measurements needed.
    const partner = await pwRequest.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${accept.token}` },
    })
    const genRes = await partner.post(
      `/partners/designs/${seed.inviteDesignId}/moodboard/generate`,
      { data: {} }
    )
    expect(genRes.status()).toBe(200)
    const gen = await genRes.json()

    const frameNames = gen.moodboard.elements
      .filter((e: any) => e.type === "frame")
      .map((f: any) => f.name)
    expect(frameNames).toEqual(
      expect.arrayContaining([
        "Brief · Concept & Identity",
        "Brief · Audience & Positioning",
        "Brief · Timeline & Budget",
      ])
    )

    const texts = gen.moodboard.elements
      .filter((e: any) => e.type === "text")
      .map((e: any) => e.text)
      .join("\n")
    expect(texts).toContain("90s Tokyo Streetwear")
    expect(texts).toContain("INR 250,000")
    expect(texts).toContain("Initial sketches")

    await admin.dispose()
    await pub.dispose()
    await partner.dispose()
  })
})
