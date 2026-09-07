/**
 * Admin API — partner capability library + onboarding questionnaire (#1531/#648).
 *
 * The admin half of two partner-owned surfaces: the photographs of what a
 * partner has made, and the questionnaire that used to be write-only from
 * the platform's point of view. The contracts worth pinning:
 *
 *   - the capability write stamps source='admin' and says when captured_at
 *     was defaulted (the library is only searchable if it admits staleness)
 *   - a sample is only reachable THROUGH its partner — another partner's
 *     sample id is a 404, not a deletion
 *   - the onboarding upsert is partial: one answer at a time, first-save
 *     creates, later saves merge rather than replace
 *   - both surfaces speak admin auth and 404 cleanly on an unknown partner
 */
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { PARTNER_MODULE } from "../../src/modules/partner"

jest.setTimeout(90 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Admin Partners API — capabilities", () => {
    let adminHeaders: { headers: Record<string, string> }
    let partnerId: string
    let otherPartnerId: string

    const postSample = (body: Record<string, unknown>, id = partnerId) =>
      api.post(`/admin/partners/${id}/capabilities`, body, adminHeaders)

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const partnerService: any = container.resolve(PARTNER_MODULE)
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const partner = await partnerService.createPartners({
        name: `Capability Admin ${unique}`,
        handle: `capability-admin-${unique}`,
      })
      partnerId = partner.id

      const other = await partnerService.createPartners({
        name: `Capability Other ${unique}`,
        handle: `capability-other-${unique}`,
      })
      otherPartnerId = other.id
    })

    it("lists empty for a fresh partner", async () => {
      const res = await api.get(
        `/admin/partners/${partnerId}/capabilities`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.samples).toEqual([])
      expect(res.data.count).toBe(0)
    })

    it("creates a sample stamped source='admin', and says when captured_at defaulted", async () => {
      const res = await postSample({
        title: "kani twill, off-white",
        technique: "kani twill",
        material: "pashmina",
        notes: "from Monday's call",
      })

      expect(res.status).toBe(201)
      const sample = res.data.sample
      expect(sample.id).toEqual(expect.stringContaining("pcap"))
      expect(sample.partner_id).toBe(partnerId)
      expect(sample.title).toBe("kani twill, off-white")
      expect(sample.technique).toBe("kani twill")
      expect(sample.material).toBe("pashmina")
      // The evidence trail: an operator typed this up, the partner did not
      // answer a wizard.
      expect(sample.source).toBe("admin")
      expect(res.data.captured_at_defaulted).toBe(true)

      // An id is not a URL, and the read path must say so — `media` is always
      // an array (best-effort resolution of unknown ids to nothing).
      expect(Array.isArray(sample.media)).toBe(true)
    })

    it("honours an explicit captured_at and reports captured_at_defaulted=false", async () => {
      const taken = "2026-01-15T10:00:00.000Z"
      const res = await postSample({
        title: "jamdani swatch",
        captured_at: taken,
      })

      expect(res.status).toBe(201)
      expect(res.data.captured_at_defaulted).toBe(false)
      expect(new Date(res.data.sample.captured_at).toISOString()).toBe(taken)
    })

    it("requires a title", async () => {
      const err = await postSample({ technique: "kani twill" }).catch(
        (e: any) => e
      )
      expect(err.response.status).toBe(400)
    })

    it("rejects partner_id in the body — the URL owns the attribution", async () => {
      const err = await postSample({
        title: "attributed elsewhere",
        partner_id: otherPartnerId,
      }).catch((e: any) => e)

      // Medusa's zodValidator forces strict: a stray field is a 400, never a
      // silently-ignored re-attribution of a competitor's work.
      expect(err.response.status).toBe(400)
    })

    it("lists newest captured_at first and forwards the technique/material filters", async () => {
      await postSample({ title: "old work", captured_at: "2026-01-01T00:00:00.000Z" })
      await postSample({ title: "new work", captured_at: "2026-02-01T00:00:00.000Z" })

      const all = await api.get(
        `/admin/partners/${partnerId}/capabilities`,
        adminHeaders
      )
      expect(all.data.count).toBe(2)
      expect(all.data.samples.map((s: any) => s.title)).toEqual([
        "new work",
        "old work",
      ])

      const filtered = await api.get(
        `/admin/partners/${partnerId}/capabilities?technique=handloom`,
        adminHeaders
      )
      expect(filtered.data.count).toBe(0)

      await postSample({ title: "handloom piece", technique: "handloom" })
      const hit = await api.get(
        `/admin/partners/${partnerId}/capabilities?technique=handloom`,
        adminHeaders
      )
      expect(hit.data.count).toBe(1)
      expect(hit.data.samples[0].title).toBe("handloom piece")
    })

    it("caps the page at 100 per request", async () => {
      for (let i = 0; i < 3; i++) {
        await postSample({ title: `sample ${i}` })
      }
      const res = await api.get(
        `/admin/partners/${partnerId}/capabilities?limit=2`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.samples).toHaveLength(2)
      expect(res.data.count).toBe(3)
    })

    it("deletes a sample through the owning partner", async () => {
      const created = await postSample({ title: "to delete" })
      const sampleId = created.data.sample.id

      const del = await api.delete(
        `/admin/partners/${partnerId}/capabilities/${sampleId}`,
        adminHeaders
      )
      expect(del.status).toBe(200)
      expect(del.data.deleted).toBe(true)
      expect(del.data.id).toBe(sampleId)

      const after = await api.get(
        `/admin/partners/${partnerId}/capabilities`,
        adminHeaders
      )
      expect(after.data.count).toBe(0)
    })

    it("refuses to delete another partner's sample (tenant guard, 404)", async () => {
      const created = await postSample(
        { title: "theirs, not ours" },
        otherPartnerId
      )
      const sampleId = created.data.sample.id

      const err = await api
        .delete(
          `/admin/partners/${partnerId}/capabilities/${sampleId}`,
          adminHeaders
        )
        .catch((e: any) => e)

      expect(err.response.status).toBe(404)

      // The evidence survives the attempt.
      const theirs = await api.get(
        `/admin/partners/${otherPartnerId}/capabilities`,
        adminHeaders
      )
      expect(theirs.data.count).toBe(1)
      expect(theirs.data.samples[0].id).toBe(sampleId)
    })

    it("404s for an unknown partner", async () => {
      const err = await api
        .get("/admin/partners/partner_does_not_exist/capabilities", adminHeaders)
        .catch((e: any) => e)
      expect(err.response.status).toBe(404)
      expect(err.response.data.message).toBe("Partner not found")
    })

    it("requires admin auth", async () => {
      const err = await api
        .get(`/admin/partners/${partnerId}/capabilities`)
        .catch((e: any) => e)
      expect(err.response.status).toBe(401)
    })
  })

  describe("Admin Partners API — onboarding profile", () => {
    let adminHeaders: { headers: Record<string, string> }
    let partnerId: string

    const putProfile = (body: Record<string, unknown>, id = partnerId) =>
      api.put(`/admin/partners/${id}/onboarding-profile`, body, adminHeaders)

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const partnerService: any = container.resolve(PARTNER_MODULE)
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const partner = await partnerService.createPartners({
        name: `Onboarding Admin ${unique}`,
        handle: `onboarding-admin-${unique}`,
      })
      partnerId = partner.id
    })

    it("reads null for a partner who has not started the wizard", async () => {
      const res = await api.get(
        `/admin/partners/${partnerId}/onboarding-profile`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.onboarding_profile).toBeNull()
    })

    it("first PUT creates the profile; later PUTs merge, not replace", async () => {
      const first = await putProfile({ does_weaving: true, team_size: 4 })
      expect(first.status).toBe(200)
      expect(first.data.onboarding_profile.partner_id).toBe(partnerId)
      expect(first.data.onboarding_profile.does_weaving).toBe(true)
      expect(first.data.onboarding_profile.team_size).toBe(4)

      // A second answer in a second call — the wizard's own partial-progress
      // semantics, reached by an operator filing a conversation.
      const second = await putProfile({ what_they_sell: "fabric" })
      expect(second.status).toBe(200)

      const read = await api.get(
        `/admin/partners/${partnerId}/onboarding-profile`,
        adminHeaders
      )
      const profile = read.data.onboarding_profile
      expect(profile.does_weaving).toBe(true) // survived the merge
      expect(profile.team_size).toBe(4)
      expect(profile.what_they_sell).toBe("fabric")
    })

    it("accepts the commercial fields (selling mode, commission, supplier flag)", async () => {
      const res = await putProfile({
        selling_mode: "core_channel_listing",
        commission_bps: 1500,
        supplies_to_platform: true,
        payment_collection: "through_us",
        completed: true,
      })
      expect(res.status).toBe(200)

      const read = await api.get(
        `/admin/partners/${partnerId}/onboarding-profile`,
        adminHeaders
      )
      const profile = read.data.onboarding_profile
      expect(profile.selling_mode).toBe("core_channel_listing")
      expect(profile.commission_bps).toBe(1500)
      expect(profile.supplies_to_platform).toBe(true)
      expect(profile.payment_collection).toBe("through_us")
      expect(profile.completed).toBe(true)
    })

    it("rejects an enum value the model does not know", async () => {
      const err = await putProfile({
        what_they_sell: "spacecraft",
      }).catch((e: any) => e)
      expect(err.response.status).toBe(400)
    })

    it("PUT 404s for an unknown partner", async () => {
      const err = await putProfile(
        { does_weaving: true },
        "partner_does_not_exist"
      ).catch((e: any) => e)
      expect(err.response.status).toBe(404)
      expect(err.response.data.message).toBe("Partner not found")
    })

    it("GET 404s for an unknown partner", async () => {
      const err = await api
        .get(
          "/admin/partners/partner_does_not_exist/onboarding-profile",
          adminHeaders
        )
        .catch((e: any) => e)
      expect(err.response.status).toBe(404)
    })

    it("requires admin auth", async () => {
      const err = await api
        .get(`/admin/partners/${partnerId}/onboarding-profile`)
        .catch((e: any) => e)
      expect(err.response.status).toBe(401)

      const putErr = await api
        .put(`/admin/partners/${partnerId}/onboarding-profile`, {
          does_weaving: true,
        })
        .catch((e: any) => e)
      expect(putErr.response.status).toBe(401)
    })
  })
})
