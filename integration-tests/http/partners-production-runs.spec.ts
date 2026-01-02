import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { consoleLoggingIntegration } from "@sentry/node"
import { error } from "node:console"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Production Runs", () => {
    const registerLoginCreatePartner = async (unique: number, label: string) => {
      
      const email = `prod-run-${label}-${unique}@medusa-test.com`

      // Register partner admin
      await api.post("/auth/partner/emailpass/register", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })

      // Login to get initial token
      const login1 = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })

      const headers1 = { Authorization: `Bearer ${login1.data.token}` }
      // Create partner entity linked to this partner admin
      const partnerRes: any = await api
        .post(
          "/partners",
          {
            name: `ProdRun ${label} ${unique}`,
            handle: `prod-run-${label}-${unique}`,
            admin: {
              email,
              first_name: "Partner",
              last_name: label,
            },
          },
          { headers: headers1 }
        )
        .catch((err: any) => err.response)

      expect(partnerRes?.status).toBe(200)
      const partnerId = partnerRes.data.partner.id

      // Fresh token after partner creation
      const login2 = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })

      const headers2 = { Authorization: `Bearer ${login2.data.token}` }



      return { partnerId, headers: headers2 }
    }

    it("should allow partner listing and retrieving own production runs (single flow)", async () => {
      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)

      const unique = Date.now()

      const a = await registerLoginCreatePartner(unique, "A")
      const partnerAId = a.partnerId
      const partnerAHeaders = a.headers

      const b = await registerLoginCreatePartner(unique, "B")
      const partnerBId = b.partnerId
      const partnerBHeaders = b.headers

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Partner Production Runs ${unique}`,
          description: "Design for partner production runs test",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
        },
        adminHeaders
      )

      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      const createParent = await api.post(
        "/admin/production-runs",
        {
          design_id: designId,
          quantity: 5,
        },
        adminHeaders
      )

      expect(createParent.status).toBe(201)
      const parentRunId = createParent.data.production_run.id

      const approveRes = await api.post(
        `/admin/production-runs/${parentRunId}/approve`,
        {
          assignments: [
            { partner_id: partnerAId, role: "cutting", quantity: 3 },
            { partner_id: partnerBId, role: "stitching", quantity: 2 },
          ],
        },
        adminHeaders
      )
      expect(approveRes.status).toBe(200)
      const children = approveRes.data.result?.children || []
      expect(children.length).toBe(2)

      const aRun = children.find(
        (c: any) => (c?.partner_id ?? c?.partnerId) === partnerAId
      )
      const bRun = children.find(
        (c: any) => (c?.partner_id ?? c?.partnerId) === partnerBId
      )

      expect(aRun?.id).toBeTruthy()
      expect(bRun?.id).toBeTruthy()

      const partnerARunId = aRun.id
      const partnerBRunId = bRun.id

      const adminGetA = await api
        .get(`/admin/production-runs/${partnerARunId}`, adminHeaders)
        .catch((err: any) => err.response)
      expect(adminGetA.status).toBe(200)
      const storedPartnerA =
        adminGetA.data?.production_run?.partner_id ??
        adminGetA.data?.production_run?.partnerId ??
        null
      expect(storedPartnerA).toBe(partnerAId)

      const adminGetB = await api
        .get(`/admin/production-runs/${partnerBRunId}`, adminHeaders)
        .catch((err: any) => err.response)
      expect(adminGetB.status).toBe(200)
      const storedPartnerB =
        adminGetB.data?.production_run?.partner_id ??
        adminGetB.data?.production_run?.partnerId ??
        null
      expect(storedPartnerB).toBe(partnerBId)

      const listA = await api
        .get("/partners/production-runs", {
          headers: partnerAHeaders,
        })
        .catch((err: any) => err.response)
      expect(listA.status).toBe(200)
      const runsA = listA.data.production_runs || []
      expect(runsA.some((r: any) => r.id === partnerARunId)).toBe(true)
      expect(runsA.some((r: any) => r.id === partnerBRunId)).toBe(false)

      const listB = await api
        .get("/partners/production-runs", {
          headers: partnerBHeaders,
        })
        .catch((err: any) => err.response)
      expect(listB.status).toBe(200)
      const runsB = listB.data.production_runs || []
      expect(runsB.some((r: any) => r.id === partnerBRunId)).toBe(true)
      expect(runsB.some((r: any) => r.id === partnerARunId)).toBe(false)

      const getOwn = await api
        .get(`/partners/production-runs/${partnerARunId}`, {
          headers: partnerAHeaders,
        })
        .catch((err: any) => err.response)
      expect(getOwn.status).toBe(200)
      expect(getOwn.data.production_run.id).toBe(partnerARunId)

      const cross = await api.get(`/partners/production-runs/${partnerARunId}`, {
        headers: partnerBHeaders,
        validateStatus: () => true,
      })
      expect(cross.status).toBe(404)
    })
  })
})
