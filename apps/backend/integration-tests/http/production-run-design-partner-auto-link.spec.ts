import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import designPartnersLink from "../../src/links/design-partners-link"
import backfillDesignPartnersFromRuns from "../../src/scripts/backfill-design-partners-from-runs"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { PARTNER_MODULE } from "../../src/modules/partner"

jest.setTimeout(180_000)

// Verifies roadmap item 27: production-run assignments auto-mirror
// into design_partners_link so /partners/designs surfaces the design
// to the partner who got the production run. Sister to
// production-run-partner-status.spec.ts which exercises the same
// workflow path end-to-end. The bug this test guards against: a
// design that was previously linked to one partner (e.g. via the
// explicit /admin/designs/:id/partners route) but re-assigned via a
// production run to a different partner used to leave the new
// partner without a design_partners_link row — they could see the
// production run but not the design.

const PARTNER_PASSWORD = "supersecret"

async function createPartner(api: any, label: string) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `dpartner-${label}-${unique}@jyt.test`
  await api.post("/auth/partner/emailpass/register", {
    email,
    password: PARTNER_PASSWORD,
  })
  let login = await api.post("/auth/partner/emailpass", {
    email,
    password: PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = {
    Authorization: `Bearer ${login.data.token}`,
  }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `DPartner ${label} ${unique}`,
      handle: `dpartner-${label}-${unique}`,
      admin: { email, first_name: "Test", last_name: "Partner" },
    },
    { headers }
  )
  expect(partnerRes.status).toBe(200)

  login = await api.post("/auth/partner/emailpass", {
    email,
    password: PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login.data.token}` }

  return {
    partnerId: partnerRes.data.partner.id as string,
    partnerHeaders: headers,
  }
}

async function createDesign(api: any, adminHeaders: any, label: string) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const res = await api.post(
    "/admin/designs",
    {
      name: `DPartner Design ${label} ${unique}`,
      description: "design_partners_link auto-link test",
      design_type: "Original",
      status: "Approved",
      priority: "Medium",
    },
    adminHeaders
  )
  expect(res.status).toBe(201)
  return res.data.design.id as string
}

async function countDesignPartnerLinks(
  container: any,
  design_id: string,
  partner_id: string
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: designPartnersLink.entryPoint,
    filters: { design_id, partner_id },
    fields: ["design_id", "partner_id"],
  })
  return data?.length ?? 0
}

async function listDesignPartnerIds(container: any, design_id: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: designPartnersLink.entryPoint,
    filters: { design_id },
    fields: ["partner_id"],
  })
  return (data ?? []).map((l: any) => l.partner_id).filter(Boolean)
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("approveProductionRunWorkflow → design_partners_link auto-link (roadmap 27)", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      // The partner-created subscriber needs this template; failure
      // here would mask the real assertions.
      try {
        await api.post(
          "/admin/email-templates",
          {
            name: "Admin Partner Created",
            template_key: "partner-created-from-admin",
            subject: "s",
            html_content: "<div>ok</div>",
            from: "t@t.com",
            variables: {},
            template_type: "email",
          },
          adminHeaders
        )
      } catch {}
    })

    it("auto-links the design to the assigned partner when no explicit link exists", async () => {
      const { partnerId } = await createPartner(api, "auto")
      const designId = await createDesign(api, adminHeaders, "auto")
      const container = getContainer()

      // Sanity: no existing design ↔ partner link.
      expect(await countDesignPartnerLinks(container, designId, partnerId)).toBe(0)

      // Assigning a production run with this partner — no explicit
      // /admin/designs/:id/partners call.
      const res = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [{ partner_id: partnerId, quantity: 1 }],
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      expect(res.data.children?.length).toBeGreaterThan(0)

      // Link now exists.
      expect(await countDesignPartnerLinks(container, designId, partnerId)).toBe(1)
    })

    it("is idempotent — re-assigning the same partner does not duplicate the link", async () => {
      const { partnerId } = await createPartner(api, "idem")
      const designId = await createDesign(api, adminHeaders, "idem")
      const container = getContainer()

      const first = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [{ partner_id: partnerId, quantity: 1 }],
        },
        adminHeaders
      )
      expect(first.status).toBe(201)
      expect(await countDesignPartnerLinks(container, designId, partnerId)).toBe(1)

      // Second run, same partner.
      const second = await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [{ partner_id: partnerId, quantity: 2 }],
        },
        adminHeaders
      )
      expect(second.status).toBe(201)

      // Still exactly one link row.
      expect(await countDesignPartnerLinks(container, designId, partnerId)).toBe(1)
    })

    it("is additive — assigning to a new partner keeps the existing link in place", async () => {
      const { partnerId: partnerA } = await createPartner(api, "addA")
      const { partnerId: partnerB } = await createPartner(api, "addB")
      const designId = await createDesign(api, adminHeaders, "add")
      const container = getContainer()

      // First assignment links A.
      await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [{ partner_id: partnerA, quantity: 1 }],
        },
        adminHeaders
      )
      expect(await countDesignPartnerLinks(container, designId, partnerA)).toBe(1)
      expect(await countDesignPartnerLinks(container, designId, partnerB)).toBe(0)

      // Second assignment to B — A must remain linked.
      await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [{ partner_id: partnerB, quantity: 1 }],
        },
        adminHeaders
      )
      const linkedIds = await listDesignPartnerIds(container, designId)
      expect(linkedIds).toContain(partnerA)
      expect(linkedIds).toContain(partnerB)
    })

    it("makes the design appear in the new partner's /partners/designs", async () => {
      const { partnerId, partnerHeaders } = await createPartner(api, "visible")
      const designId = await createDesign(api, adminHeaders, "visible")

      // Pre-state: partner sees no designs from this run yet.
      const before = await api.get("/partners/designs?limit=100", {
        headers: partnerHeaders,
      })
      const beforeIds = (before.data.designs || []).map((d: any) => d.id)
      expect(beforeIds).not.toContain(designId)

      // Assign the run.
      await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [{ partner_id: partnerId, quantity: 1 }],
        },
        adminHeaders
      )

      // The partner now sees this design on /partners/designs.
      const after = await api.get("/partners/designs?limit=100", {
        headers: partnerHeaders,
      })
      const afterIds = (after.data.designs || []).map((d: any) => d.id)
      expect(afterIds).toContain(designId)
    })
  })

  describe("scripts/backfill-design-partners-from-runs (roadmap 27)", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      try {
        await api.post(
          "/admin/email-templates",
          {
            name: "Admin Partner Created",
            template_key: "partner-created-from-admin",
            subject: "s",
            html_content: "<div>ok</div>",
            from: "t@t.com",
            variables: {},
            template_type: "email",
          },
          adminHeaders
        )
      } catch {}
    })

    it("recovers legacy runs whose design_partners_link row was dismissed", async () => {
      const { partnerId } = await createPartner(api, "bf")
      const designId = await createDesign(api, adminHeaders, "bf")
      const container = getContainer()
      const remoteLink = container.resolve(
        ContainerRegistrationKeys.LINK
      ) as any

      // Approve via the workflow — link gets auto-created by the
      // fix this same PR ships. To simulate legacy state (run exists
      // but link doesn't), dismiss the link after creation.
      await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [{ partner_id: partnerId, quantity: 1 }],
        },
        adminHeaders
      )
      expect(await countDesignPartnerLinks(container, designId, partnerId)).toBe(1)

      await remoteLink.dismiss({
        [DESIGN_MODULE]: { design_id: designId },
        [PARTNER_MODULE]: { partner_id: partnerId },
      })
      expect(await countDesignPartnerLinks(container, designId, partnerId)).toBe(0)

      // Backfill should re-create the link from the still-existing
      // production_run row.
      await backfillDesignPartnersFromRuns({ container, args: [] } as any)

      expect(await countDesignPartnerLinks(container, designId, partnerId)).toBe(1)
    })

    it("is a no-op on a clean DB and is idempotent across re-runs", async () => {
      const { partnerId } = await createPartner(api, "noop")
      const designId = await createDesign(api, adminHeaders, "noop")
      const container = getContainer()

      await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [{ partner_id: partnerId, quantity: 1 }],
        },
        adminHeaders
      )

      // First backfill: link already there from the workflow → no
      // additional creates.
      await backfillDesignPartnersFromRuns({ container, args: [] } as any)
      expect(await countDesignPartnerLinks(container, designId, partnerId)).toBe(1)

      // Second backfill: still exactly one.
      await backfillDesignPartnersFromRuns({ container, args: [] } as any)
      expect(await countDesignPartnerLinks(container, designId, partnerId)).toBe(1)
    })

    it("--dry-run leaves the link table untouched", async () => {
      const { partnerId } = await createPartner(api, "dry")
      const designId = await createDesign(api, adminHeaders, "dry")
      const container = getContainer()
      const remoteLink = container.resolve(
        ContainerRegistrationKeys.LINK
      ) as any

      await api.post(
        `/admin/designs/${designId}/production-runs`,
        {
          assignments: [{ partner_id: partnerId, quantity: 1 }],
        },
        adminHeaders
      )

      // Simulate legacy state.
      await remoteLink.dismiss({
        [DESIGN_MODULE]: { design_id: designId },
        [PARTNER_MODULE]: { partner_id: partnerId },
      })

      // Dry run — no mutation.
      await backfillDesignPartnersFromRuns({
        container,
        args: ["--dry-run"],
      } as any)
      expect(await countDesignPartnerLinks(container, designId, partnerId)).toBe(0)

      // Real run mutates.
      await backfillDesignPartnersFromRuns({ container, args: [] } as any)
      expect(await countDesignPartnerLinks(container, designId, partnerId)).toBe(1)
    })
  })
})
