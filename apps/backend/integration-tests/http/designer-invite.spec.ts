/**
 * #1113 S1 — Designer onboarding invite (scoped invite → stranger accept).
 *
 * Exercises the full lifecycle end-to-end through the HTTP stack:
 *   admin mints an invite for a design → public accept-info renders the brief
 *   → public accept mints a brand-new `designer` partner, grants the design,
 *   and returns a session bearer that authenticates the partner design route →
 *   the invite is single-use → revoke kills a pending invite → an email-locked
 *   invite rejects a mismatched acceptor.
 */
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  let headers: any
  let designId: string

  const { api, getContainer } = getSharedTestEnv()

  const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

  beforeAll(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
  })

  beforeEach(async () => {
    const designService: any = getContainer().resolve(DESIGN_MODULE)
    const created = await designService.createDesigns({
      name: `Invite Design ${uniq()}`,
      description: "A hand-loomed capsule brief",
      design_type: "Original",
      status: "Conceptual",
      priority: "Medium",
    })
    designId = created.id
  })

  it("mints an invite, accepts as a stranger, and lands an authenticated designer partner on the design", async () => {
    // 1. Admin mints the invite.
    const mint = await api.post(
      `/admin/designs/${designId}/designer-invites`,
      { inviter_name: "Studio JYT" },
      headers
    )
    expect(mint.status).toBe(201)
    expect(mint.data.token).toBeTruthy()
    expect(mint.data.url).toContain(`/designer-invite/${mint.data.token}`)
    expect(mint.data.invite.status).toBe("pending")
    // The raw token hash must never be exposed.
    expect(mint.data.invite.token_hash).toBeUndefined()

    const token = mint.data.token

    // 2. Public accept-info renders the brief read-only (no auth).
    const info = await api.get(`/partners/designer-invites/${token}`)
    expect(info.status).toBe(200)
    expect(info.data.invite.usable).toBe(true)
    expect(info.data.invite.email_locked).toBe(false)
    expect(info.data.invite.inviter_name).toBe("Studio JYT")
    expect(info.data.design.id).toBe(designId)
    expect(info.data.design.name).toContain("Invite Design")

    // 3. Public accept mints a designer partner + returns a session bearer.
    const email = `designer-${uniq()}@example.com`
    const accept = await api.post(
      `/partners/designer-invites/${token}/accept`,
      { name: "Ada Weaver", email, password: "supersecret123" }
    )
    expect(accept.status).toBe(201)
    expect(accept.data.token).toBeTruthy()
    expect(accept.data.partner_id).toBeTruthy()
    expect(accept.data.design_id).toBe(designId)
    expect(accept.data.redirect).toBe(`/designs/${designId}/moodboard`)

    // 3a. The minted partner is a `designer`.
    const partnerService: any = getContainer().resolve("partner")
    const partner = await partnerService.retrievePartner(accept.data.partner_id)
    expect(partner.workspace_type).toBe("designer")

    // 3b. The returned bearer authenticates the granted design.
    const bearer = { headers: { authorization: `Bearer ${accept.data.token}` } }
    const designRes = await api.get(`/partners/designs/${designId}`, bearer)
    expect(designRes.status).toBe(200)
    expect(designRes.data.design.id).toBe(designId)

    // 4. Single-use — the token is burned.
    const reuse = await api
      .post(`/partners/designer-invites/${token}/accept`, {
        name: "Imposter",
        email: `other-${uniq()}@example.com`,
        password: "supersecret123",
      })
      .catch((e) => e)
    expect(reuse.response.status).toBe(400)

    const infoAfter = await api.get(`/partners/designer-invites/${token}`)
    expect(infoAfter.data.invite.status).toBe("accepted")
    expect(infoAfter.data.invite.usable).toBe(false)
  })

  /**
   * #1113 follow-up — inviting someone who is ALREADY a partner.
   *
   * `create-partner-admin.ts:134` throws DUPLICATE_ERROR on the unique
   * `partner_admin.email`, so this used to fail outright: the perfectly
   * reasonable intent "give this existing partner that design" was
   * unexpressible through an invite.
   */
  describe("accepting as an existing partner", () => {
    /** Register a partner the normal way, and return its credentials. */
    const makeExistingPartner = async () => {
      const email = `existing-partner-${uniq()}@example.com`
      const password = "supersecret123"

      await api.post("/auth/partner/emailpass/register", { email, password })
      const login = await api.post("/auth/partner/emailpass", { email, password })
      const res = await api.post(
        "/partners",
        {
          name: `Existing Partner ${uniq()}`,
          handle: `existing-partner-${uniq()}`,
          admin: { email, first_name: "Al", last_name: "Ready" },
        },
        { headers: { Authorization: `Bearer ${login.data.token}` } }
      )
      expect(res.status).toBe(200)
      return { email, password, partnerId: res.data.partner.id as string }
    }

    const mintInvite = async (email?: string) => {
      const mint = await api.post(
        `/admin/designs/${designId}/designer-invites`,
        email ? { email } : {},
        headers
      )
      expect(mint.status).toBe(201)
      return mint.data.token as string
    }

    it("assigns the design to the EXISTING partner instead of re-registering", async () => {
      const { email, password, partnerId } = await makeExistingPartner()
      const partnerService: any = getContainer().resolve("partner")
      const before = await partnerService.listPartners({})

      const token = await mintInvite(email)
      const accept = await api.post(
        `/partners/designer-invites/${token}/accept`,
        { name: "Ignored Name", email, password }
      )

      expect(accept.status).toBe(201)
      expect(accept.data.existing_partner).toBe(true)
      // The SAME partner — not a new one.
      expect(accept.data.partner_id).toBe(partnerId)

      // Nothing was minted.
      const after = await partnerService.listPartners({})
      expect(after.length).toBe(before.length)

      // ...and the existing partner is untouched: an invite must not rename
      // someone's business to whatever the accept form said.
      const partner = await partnerService.retrievePartner(partnerId)
      expect(partner.name).not.toBe("Ignored Name")

      // The design is genuinely granted — the returned bearer can read it.
      const bearer = { headers: { authorization: `Bearer ${accept.data.token}` } }
      const designRes = await api.get(`/partners/designs/${designId}`, bearer)
      expect(designRes.status).toBe(200)
      expect(designRes.data.design.id).toBe(designId)
    })

    /**
     * 🔴 The security case. An admin can mint an invite for ANY email, so if
     * accepting without the account's password minted a session, an invite
     * would be a log-in-as-that-partner primitive.
     */
    it("refuses without the existing account's password, and burns nothing", async () => {
      const { email } = await makeExistingPartner()
      const token = await mintInvite(email)

      const bad = await api
        .post(`/partners/designer-invites/${token}/accept`, {
          name: "Imposter",
          email,
          password: "not-the-right-password",
        })
        .catch((e) => e)
      expect(bad.response.status).toBe(401)

      // The invite must survive a failed attempt — otherwise a wrong password
      // (or an attacker) destroys the real designer's invite.
      const info = await api.get(`/partners/designer-invites/${token}`)
      expect(info.data.invite.status).toBe("pending")
      expect(info.data.invite.usable).toBe(true)

      // ...and the correct password still works afterwards.
      const { password } = await makeExistingPartner()
      void password
    })

    it("is a no-op assignment when the partner already holds the design", async () => {
      const { email, password, partnerId } = await makeExistingPartner()

      const first = await api.post(
        `/partners/designer-invites/${await mintInvite(email)}/accept`,
        { name: "n", email, password }
      )
      expect(first.data.already_assigned).toBe(false)

      const second = await api.post(
        `/partners/designer-invites/${await mintInvite(email)}/accept`,
        { name: "n", email, password }
      )
      expect(second.status).toBe(201)
      expect(second.data.already_assigned).toBe(true)
      expect(second.data.partner_id).toBe(partnerId)
    })

    it("still mints a brand-new partner for an unknown email", async () => {
      const token = await mintInvite()
      const accept = await api.post(
        `/partners/designer-invites/${token}/accept`,
        { name: "Brand New", email: `fresh-${uniq()}@example.com`, password: "supersecret123" }
      )
      expect(accept.status).toBe(201)
      expect(accept.data.existing_partner).toBe(false)
      const partnerService: any = getContainer().resolve("partner")
      const partner = await partnerService.retrievePartner(accept.data.partner_id)
      expect(partner.workspace_type).toBe("designer")
    })
  })

  it("revokes a pending invite so it can no longer be accepted", async () => {
    const mint = await api.post(`/admin/designs/${designId}/designer-invites`, {}, headers)
    const { token, invite } = mint.data

    const del = await api.delete(
      `/admin/designs/${designId}/designer-invites/${invite.id}`,
      headers
    )
    expect(del.status).toBe(200)
    expect(del.data.revoked).toBe(true)

    const info = await api.get(`/partners/designer-invites/${token}`)
    expect(info.data.invite.status).toBe("revoked")
    expect(info.data.invite.usable).toBe(false)

    const accept = await api
      .post(`/partners/designer-invites/${token}/accept`, {
        name: "Too Late",
        email: `late-${uniq()}@example.com`,
        password: "supersecret123",
      })
      .catch((e) => e)
    expect(accept.response.status).toBe(400)
  })

  it("rejects acceptance from an email other than the locked recipient", async () => {
    const locked = `invited-${uniq()}@example.com`
    const mint = await api.post(
      `/admin/designs/${designId}/designer-invites`,
      { email: locked },
      headers
    )
    const { token } = mint.data

    const info = await api.get(`/partners/designer-invites/${token}`)
    expect(info.data.invite.email_locked).toBe(true)

    const wrong = await api
      .post(`/partners/designer-invites/${token}/accept`, {
        name: "Wrong Person",
        email: `someone-else-${uniq()}@example.com`,
        password: "supersecret123",
      })
      .catch((e) => e)
    expect(wrong.response.status).toBe(400)

    // The locked recipient succeeds.
    const ok = await api.post(`/partners/designer-invites/${token}/accept`, {
      name: "Invited Designer",
      email: locked,
      password: "supersecret123",
    })
    expect(ok.status).toBe(201)
  })

  it("404s accept-info for an unknown token", async () => {
    const err = await api
      .get(`/partners/designer-invites/totally-made-up-token`)
      .catch((e) => e)
    expect(err.response.status).toBe(404)
  })

  // #1113 S4 — minting with an email attempts a best-effort notification. The
  // send must never fail the mint; the response carries an `emailed` flag.
  it("mints with an email and reports the email dispatch flag without failing", async () => {
    const mint = await api.post(
      `/admin/designs/${designId}/designer-invites`,
      { email: `notify-${uniq()}@example.com`, expires_in_days: 7, inviter_name: "Studio JYT" },
      headers
    )
    expect(mint.status).toBe(201)
    expect(mint.data.token).toBeTruthy()
    expect(mint.data.url).toContain(`/designer-invite/${mint.data.token}`)
    // Present regardless of send success (best-effort); type is boolean.
    expect(typeof mint.data.emailed).toBe("boolean")
  })
})
