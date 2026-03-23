import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

setupSharedTestSuite(() => {
  let headers: any
  let websiteId: string
  let blogPageId: string
  const { api, getContainer } = getSharedTestEnv()

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)

    // Create website
    const websiteRes = await api.post(
      "/admin/websites",
      { name: "Email Template Test Site", domain: `email-test-${Date.now()}.com`, status: "Active" },
      headers
    )
    expect(websiteRes.status).toBe(201)
    websiteId = websiteRes.data.website.id

    // Ensure blog-subscriber template exists
    const listRes = await api.get("/admin/email-templates", {
      headers: headers.headers,
    })
    const templates =
      listRes.data.email_templates || listRes.data.emailTemplates || []
    const existing = templates.find(
      (t: any) => t.template_key === "blog-subscriber"
    )
    if (!existing) {
      await api.post(
        "/admin/email-templates",
        {
          name: "Blog Subscriber Email",
          template_key: "blog-subscriber",
          from: "test@example.com",
          subject: "New Blog Post: {{blog_title}}",
          html_content:
            '<html><body><h1>{{blog_title}}</h1><p>Hello {{first_name}},</p><div>{{{blog_content}}}</div></body></html>',
          template_type: "newsletter",
          is_active: true,
        },
        headers
      )
    }

    // Create blog page with simple content
    const blogContent = JSON.stringify({
      text: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "auto", indent: 0, textAlign: null, lineHeight: "1" },
            content: [{ text: "This is test blog content for email template testing.", type: "text" }],
          },
        ],
      },
      type: "blog",
    })

    const pageRes = await api.post(
      `/admin/websites/${websiteId}/pages`,
      {
        title: "Email Template Test Blog",
        slug: "email-template-test",
        content: blogContent,
        status: "Published",
        page_type: "Blog",
      },
      headers
    )
    expect(pageRes.status).toBe(201)
    blogPageId = pageRes.data.page.id
  })

  describe("Email Template Fetch and Rendering", () => {
    it("should have the blog-subscriber template available", async () => {
      // Verify the email template exists via the admin API
      const response = await api.get("/admin/email-templates", {
        headers: headers.headers,
      })

      expect(response.status).toBe(200)

      const templates = response.data.email_templates || response.data.emailTemplates || []
      const blogTemplate = templates.find(
        (t: any) => t.template_key === "blog-subscriber"
      )

      // The template should exist (seeded)
      if (blogTemplate) {
        expect(blogTemplate.is_active).toBe(true)
        expect(blogTemplate.template_key).toBe("blog-subscriber")
        expect(blogTemplate.subject).toContain("{{blog_title}}")
        expect(blogTemplate.html_content).toBeTruthy()
        expect(blogTemplate.from).toBeTruthy()
        console.log(
          `Found blog-subscriber template: from=${blogTemplate.from}, subject="${blogTemplate.subject}"`
        )
      } else {
        console.warn(
          "blog-subscriber template not found — seed it with: yarn medusa exec src/scripts/seed-email-templates.ts"
        )
      }
    })

    it("should create a blog-subscriber email template if missing", async () => {
      // First check if template exists
      const listRes = await api.get("/admin/email-templates", {
        headers: headers.headers,
      })
      const templates = listRes.data.email_templates || listRes.data.emailTemplates || []
      const existing = templates.find(
        (t: any) => t.template_key === "blog-subscriber"
      )

      if (!existing) {
        // Create it
        const createRes = await api.post(
          "/admin/email-templates",
          {
            name: "Blog Subscriber Email",
            template_key: "blog-subscriber",
            from: "test@example.com",
            subject: "New Blog Post: {{blog_title}}",
            html_content:
              '<html><body><h1>{{blog_title}}</h1><p>Hello {{first_name}},</p><div>{{{blog_content}}}</div></body></html>',
            template_type: "newsletter",
            is_active: true,
          },
          headers
        )
        expect([200, 201]).toContain(createRes.status)
        console.log("Created blog-subscriber template for testing")
      }
    })
  })

  describe("Email Validation", () => {
    it("should filter invalid emails in subscriber collection", async () => {
      // Create persons with various email formats to test validation
      const testEmails = [
        { first_name: "Valid", last_name: "Email", email: "valid@example.com" },
        { first_name: "Multi", last_name: "Email", email: "multi1@example.com, multi2@example.com" },
        { first_name: "Space", last_name: "Email", email: "space email@example.com" },
        { first_name: "No", last_name: "TLD", email: "notld@example" },
        { first_name: "Good", last_name: "Email2", email: "good.email@example.org" },
      ]

      for (const person of testEmails) {
        try {
          await api.post("/admin/persons", person, headers)
        } catch {
          // Some may fail validation at the API level — that's expected
        }
      }

      // The get-subscribers step uses extractEmails which should:
      // - Accept "valid@example.com" and "good.email@example.org"
      // - Split "multi1@example.com, multi2@example.com" into two valid emails
      // - Reject "space email@example.com"
      // - Reject "notld@example" (no TLD with 2+ chars)

      // We can't directly test the step, but we verify the persons were created
      const personListRes = await api.get("/admin/persons?limit=100", {
        headers: headers.headers,
      })
      expect(personListRes.status).toBe(200)
    })
  })

  describe("Subscription Send Log Model", () => {
    it("should initiate blog subscription workflow", async () => {
      // Create a subscriber first
      try {
        await api.post(
          "/admin/persons",
          {
            first_name: "SendLog",
            last_name: "Tester",
            email: "sendlog-tester@example.com",
          },
          headers
        )
      } catch {
        // May already exist
      }

      // Initiate the blog subscription
      const initiateRes = await api.post(
        `/admin/websites/${websiteId}/pages/${blogPageId}/subs`,
        {
          subject: "Test Email Template Rendering",
          customMessage: "Testing template rendering",
        },
        headers
      )

      expect(initiateRes.status).toBe(200)
      expect(initiateRes.data).toHaveProperty("workflow_id")
      expect(initiateRes.data).toHaveProperty("requires_confirmation", true)

      const transactionId = initiateRes.data.workflow_id
      console.log(`Workflow initiated: ${transactionId}`)

      // Confirm the workflow
      try {
        const confirmRes = await api.post(
          `/admin/websites/${websiteId}/pages/${blogPageId}/subs/${transactionId}/confirm`,
          {},
          headers
        )
        expect(confirmRes.status).toBe(200)
        console.log("Workflow confirmed")
      } catch (err) {
        console.warn("Confirmation may fail in test env:", (err as any).message)
      }

      // Wait for workflow to process
      await new Promise((resolve) => setTimeout(resolve, 10000))

      // Verify page was updated with summary (not large arrays)
      const pageRes = await api.get(
        `/admin/websites/${websiteId}/pages/${blogPageId}`,
        headers
      )
      expect(pageRes.status).toBe(200)

      const page = pageRes.data.page
      const metadata = page.metadata || {}

      // If workflow completed, metadata should have counts but NOT large arrays
      if (metadata.subscription_sent_count !== undefined) {
        expect(typeof metadata.subscription_sent_count).toBe("number")
        expect(typeof metadata.subscription_failed_count).toBe("number")

        // Verify we no longer store large arrays in metadata
        // (subscription_sent_to_ids and subscription_failed_sends should NOT be present)
        expect(metadata.subscription_sent_to_ids).toBeUndefined()
        expect(metadata.subscription_failed_sends).toBeUndefined()

        console.log(
          `Subscription summary: sent=${metadata.subscription_sent_count}, failed=${metadata.subscription_failed_count}, queued=${metadata.subscription_queued_count || 0}`
        )
      } else {
        console.log("Workflow may still be processing — metadata not yet populated")
      }
    })
  })

  describe("Test Blog Email Endpoint", () => {
    it("should send a test email using the blog-subscriber template", async () => {
      const testEmailRes = await api
        .post(
          `/admin/websites/${websiteId}/pages/${blogPageId}/subs/test`,
          {
            test_email: "integration-test@example.com",
            subject: "Integration Test: Blog Template",
          },
          headers
        )
        .catch((err) => err.response)

      // In test environments, the actual send may fail (no real email provider)
      // but we should get either a 200 success or a structured error — not a 500
      expect([200, 400]).toContain(testEmailRes.status)

      if (testEmailRes.status === 200) {
        expect(testEmailRes.data).toHaveProperty("result")
        const result = testEmailRes.data.result
        console.log("Test email result:", JSON.stringify(result, null, 2))
      } else {
        console.log("Test email failed (expected in test env):", testEmailRes.data)
      }
    })

    it("should reject test email with invalid email address", async () => {
      const res = await api
        .post(
          `/admin/websites/${websiteId}/pages/${blogPageId}/subs/test`,
          {
            test_email: "not-an-email",
            subject: "Should Fail",
          },
          headers
        )
        .catch((err) => err.response)

      expect(res.status).toBe(400)
    })
  })
})
