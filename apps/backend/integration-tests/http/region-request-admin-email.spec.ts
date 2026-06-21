import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { sendRegionRequestAdminEmailWorkflow } from "../../src/workflows/email/workflows/send-region-request-admin-email"
import {
  buildRegionRequestAdminEmailData,
  resolveRegionRequestRecipient,
} from "../../src/workflows/email/lib/region-request-admin-email"

jest.setTimeout(60 * 1000)

/**
 * #576 slice C — region-request → admin email.
 * The base/local config has no real email provider, so we assert the workflow
 * compiles + resolves the seeded `region-request-admin` template and runs
 * end-to-end, plus exercise the pure recipient/data helpers against the route's
 * data shape.
 */
setupSharedTestSuite(() => {
  describe("region request → admin email (#576 slice C)", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeEach(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      // The shared runner truncates between tests, so (re)seed per test.
      // This template key is not part of the common seed set.
      try {
        await api.post(
          "/admin/email-templates",
          {
            name: "Region Request Admin",
            template_key: "region-request-admin",
            subject: "{{title}}",
            html_content:
              "<div>{{name}} <{{email}}> — {{country_code}} — {{message}}</div>",
            from: "ops@jaalyantra.com",
            variables: {},
            template_type: "email",
          },
          adminHeaders
        )
      } catch {
        // already seeded in a prior test within this shared DB — ignore
      }
    })

    it("has the seeded region-request-admin template", async () => {
      const { api } = getSharedTestEnv()
      const res = await api.get("/admin/email-templates", adminHeaders)
      const templates =
        res.data.email_templates || res.data.emailTemplates || []
      const tmpl = templates.find(
        (t: any) => t.template_key === "region-request-admin"
      )
      expect(tmpl).toBeDefined()
      expect(tmpl.is_active).toBe(true)
    })

    it("runs the admin email workflow against the seeded template", async () => {
      const container = getSharedTestEnv().getContainer()

      const data = buildRegionRequestAdminEmailData({
        name: "Asha",
        email: "asha@example.com",
        message: "Please ship to Nepal",
        countryCode: "np",
        productHandle: "silk-saree",
        storeName: "Asha Textiles",
        receivedAt: new Date().toISOString(),
      })

      // The workflow returns no WorkflowResponse (mirrors slice A), so
      // completing without errors is the success signal.
      const run = await sendRegionRequestAdminEmailWorkflow(container).run({
        input: { to: "ops@jaalyantra.com", data },
      })
      expect(run.errors).toEqual([])
    })

    it("does not throw when run with throwOnError:false (route best-effort contract)", async () => {
      const container = getSharedTestEnv().getContainer()
      const data = buildRegionRequestAdminEmailData({
        name: "Bo",
        email: "bo@example.com",
      })

      // The route calls the workflow with throwOnError:false and wraps it in a
      // try/catch so a provider/template problem can never 500 the storefront
      // submission. Assert the run resolves to an errors array rather than
      // rejecting.
      const run = await sendRegionRequestAdminEmailWorkflow(container).run({
        input: { to: "ops@jaalyantra.com", data },
        throwOnError: false,
      })
      expect(Array.isArray(run.errors)).toBe(true)
    })

    it("resolves the recipient from REGION_REQUEST_NOTIFY_EMAIL", () => {
      const recipient = resolveRegionRequestRecipient({
        REGION_REQUEST_NOTIFY_EMAIL: "ops@jaalyantra.com",
      })
      expect(recipient?.email).toBe("ops@jaalyantra.com")
    })

    it("returns null recipient when nothing is configured (route skips email)", () => {
      expect(resolveRegionRequestRecipient({})).toBeNull()
    })
  })
})
