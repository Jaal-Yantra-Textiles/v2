import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import designPartnersLink from "../../src/links/design-partners-link"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { PARTNER_MODULE } from "../../src/modules/partner"

jest.setTimeout(60 * 1000)

/**
 * #2306 S1 — a design's partner roster carries a production stage per partner.
 *
 * The stage lives in the link's `stage_role` column. `role` is a different
 * question (prospect / maker / designer) and must survive a stage change.
 */
setupSharedTestSuite(() => {
  describe("Admin design partner roster — stage roles (#2306 S1)", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    const createPartner = async (label: string) => {
      const { api } = getSharedTestEnv()
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
      const res = await api.post(
        "/admin/partners",
        {
          partner: { name: `Roster ${label} ${unique}`, handle: `roster-${label}-${unique}` },
          admin: {
            email: `roster-${label}-${unique}@jyt.test`,
            first_name: "Roster",
            last_name: label,
          },
        },
        adminHeaders
      )
      return res.data.partner.id as string
    }

    const createDesign = async () => {
      const { api } = getSharedTestEnv()
      const res = await api.post(
        "/admin/designs",
        { name: `Roster design ${Date.now()}`, description: "roster" },
        adminHeaders
      )
      return res.data.design.id as string
    }

    /** Read the link rows straight from the link table, not through the route. */
    const readLinks = async (designId: string) => {
      const query = getSharedTestEnv().getContainer().resolve(
        ContainerRegistrationKeys.QUERY
      ) as any
      const { data } = await query.graph({
        entity: designPartnersLink.entryPoint,
        filters: { design_id: designId },
        fields: ["partner_id", "role", "stage_role", "sla_days"],
      })
      return new Map<string, any>((data ?? []).map((l: any) => [l.partner_id, l]))
    }

    it("links partners with a stage, and linking messages nobody", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const [weaver, embroiderer, plain] = [
        await createPartner("weaver"),
        await createPartner("embroiderer"),
        await createPartner("plain"),
      ]
      const designId = await createDesign()

      const notifications = getContainer().resolve(Modules.NOTIFICATION) as any
      const before = await notifications.listNotifications({}, { take: 1000 })

      const res = await api.post(
        `/admin/designs/${designId}/partner`,
        {
          partners: [
            { partner_id: weaver, stage_role: "weaving" },
            { partner_id: embroiderer, stage_role: "embroidery" },
          ],
          partnerIds: [plain],
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      expect(res.data.linked.sort()).toEqual([weaver, embroiderer, plain].sort())

      const links = await readLinks(designId)
      expect(links.get(weaver)?.stage_role).toBe("weaving")
      expect(links.get(embroiderer)?.stage_role).toBe("embroidery")
      expect(links.get(plain)?.stage_role).toBeNull()

      // assign ≠ send: only the admin feed hears about a roster change.
      const after = await notifications.listNotifications({}, { take: 1000 })
      const beforeIds = new Set(before.map((n: any) => n.id))
      const added = after.filter((n: any) => !beforeIds.has(n.id))
      expect(added.filter((n: any) => n.channel !== "feed")).toEqual([])

      const roster = await api.get(`/admin/designs/${designId}/partner`, adminHeaders)
      expect(roster.status).toBe(200)
      const byId = new Map<string, any>(
        roster.data.roster.map((r: any) => [r.partner_id, r])
      )
      expect(byId.get(weaver)).toMatchObject({ stage_role: "weaving", role: null })
      expect(byId.get(weaver)?.partner?.id).toBe(weaver)
      expect(byId.get(plain)?.stage_role).toBeNull()
    })

    it("changes a stage without touching role; omitted keeps it, null clears it", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const partnerId = await createPartner("maker")
      const designId = await createDesign()

      // A design-inquiry winner: role=maker, with an SLA — both must survive.
      const remoteLink = getContainer().resolve(ContainerRegistrationKeys.LINK) as any
      await remoteLink.create([
        {
          [DESIGN_MODULE]: { design_id: designId },
          [PARTNER_MODULE]: { partner_id: partnerId },
          data: { role: "maker", sla_days: 12 },
        },
      ])

      const set = await api.post(
        `/admin/designs/${designId}/partner`,
        { partners: [{ partner_id: partnerId, stage_role: "stitching" }] },
        adminHeaders
      )
      expect(set.data).toEqual({ linked: [], stage_changed: [partnerId] })
      let link = (await readLinks(designId)).get(partnerId)
      expect(link).toMatchObject({ role: "maker", sla_days: 12, stage_role: "stitching" })

      // An old caller re-linking by id must not wipe the stage.
      const relink = await api.post(
        `/admin/designs/${designId}/partner`,
        { partnerIds: [partnerId] },
        adminHeaders
      )
      expect(relink.data).toEqual({ linked: [], stage_changed: [] })
      link = (await readLinks(designId)).get(partnerId)
      expect(link).toMatchObject({ role: "maker", sla_days: 12, stage_role: "stitching" })

      const cleared = await api.post(
        `/admin/designs/${designId}/partner`,
        { partners: [{ partner_id: partnerId, stage_role: null }] },
        adminHeaders
      )
      expect(cleared.data.stage_changed).toEqual([partnerId])
      link = (await readLinks(designId)).get(partnerId)
      expect(link).toMatchObject({ role: "maker", sla_days: 12, stage_role: null })
      expect((await readLinks(designId)).size).toBe(1)
    })

    it("refuses a stage outside the fixed list, and an empty body", async () => {
      const { api } = getSharedTestEnv()
      const partnerId = await createPartner("bad")
      const designId = await createDesign()

      const bad = await api
        .post(
          `/admin/designs/${designId}/partner`,
          { partners: [{ partner_id: partnerId, stage_role: "Sampling For One Client" }] },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(bad.status).toBe(400)

      const empty = await api
        .post(`/admin/designs/${designId}/partner`, {}, adminHeaders)
        .catch((e: any) => e.response)
      expect(empty.status).toBe(400)

      expect((await readLinks(designId)).size).toBe(0)
    })
  })
})
