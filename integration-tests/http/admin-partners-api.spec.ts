import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(({ api, getContainer }) => {
  describe("Admin Partners API", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      // Ensure an admin user exists for this test run
      const container = await getContainer()
      await createAdminUser(container)
      // Create the email template used by the subscriber workflow
      adminHeaders = await getAuthHeaders(api)
      await api.post(
        "/admin/email-templates",
        {
          name: "Admin Partner Created",
          template_key: "partner-created-from-admin",
          subject: "You're invited to set up your partner account at {{partner_name}}",
          html_content: `
            <div>
              <h1>Welcome to {{partner_name}}</h1>
              <p>Your partner admin account has been created by our team.</p>
              <p>Temporary password: <strong>{{temp_password}}</strong></p>
              <p>Please log in and change your password immediately.</p>
            </div>
          `,
          from: "partners@jaalyantra.com",
          variables: {
            partner_name: "Partner display name",
            temp_password: "Temporary password issued to the partner admin"
          },
          template_type: "email",
        },
        adminHeaders
      )
    })

    // beforeEach(async () => {
    //   // Get fresh admin auth token before each test
    //   adminHeaders = await getAuthHeaders(api)
    // })

    test("POST /admin/partners creates partner and admin", async () => {
      const unique = Date.now()
      const payload = {
        partner: {
          name: `Acme Admin ${unique}`,
          handle: `acme-admin-${unique}`,
        },
        admin: {
          email: `partner-admin-${unique}@jyt.test`,
          first_name: "Admin",
          last_name: "User",
        },
      }

      const res = await api.post("/admin/partners", payload, adminHeaders)

      expect(res.status).toBe(201)
      expect(res.data.partner).toBeDefined()
      expect(res.data.partner.name).toBe(payload.partner.name)
      expect(res.data.partner.handle).toBe(payload.partner.handle)
      expect(res.data.partner_admin).toBeDefined()
      expect(res.data.partner_admin.email).toBe(payload.admin.email)
    })

    test("POST /admin/partners with duplicate handle returns 400", async () => {
      const unique = Date.now()
      const baseHandle = `acme-admin-dupe-${unique}`
      const first = {
        partner: {
          name: `Acme Admin Dupe ${unique}`,
          handle: baseHandle,
        },
        admin: {
          email: `partner-admin-dupe-${unique}@jyt.test`,
          first_name: "Admin",
          last_name: "User",
        },
      }

      const second = {
        partner: {
          name: `Acme Admin Dupe ${unique}`,
          handle: baseHandle,
        },
        admin: {
          email: `partner-admin-dupe2-${unique}@jyt.test`,
          first_name: "Admin",
          last_name: "User",
        },
      }

      console.log("[TEST] Creating first partner", first)
      const ok = await api.post("/admin/partners", first, adminHeaders)
      console.log("[TEST] First POST status:", ok.status)
      console.log("[TEST] First POST data:", JSON.stringify(ok.data))
      expect(ok.status).toBe(201)

      console.log("[TEST] Creating second partner (expect 400)", second)
      try {
        const resp = await api.post("/admin/partners", second, adminHeaders)
        console.log("[TEST][UNEXPECTED] Second POST status:", resp.status)
        console.log("[TEST][UNEXPECTED] Second POST data:", JSON.stringify(resp.data))
        // If it gets here, fail explicitly
        expect(resp.status).toBe(400)
      } catch (err: any) {
        const res = err?.response || {}
        console.log("[TEST] Second POST error status:", res?.status)
        console.log("[TEST] Second POST error data:", JSON.stringify(res?.data))
        console.log("[TEST] Second POST error headers:", JSON.stringify(res?.headers))
        console.log("[TEST] Second POST request URL:", res?.config?.url)
        console.log("[TEST] Second POST request data:", JSON.stringify(res?.config?.data))
        expect(res.status).toBe(400)
        expect(res.data?.message).toBe(
          `A partner with handle "${baseHandle}" already exists. Please use a unique handle.`
        )
      }
    })
  })
})
