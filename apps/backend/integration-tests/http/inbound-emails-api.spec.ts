import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(30000)
setupSharedTestSuite(() => {
  let headers: any
  const { api, getContainer } = getSharedTestEnv()

  // Helper: create an inbound email directly via the module service
  const createTestEmail = async (overrides: Record<string, any> = {}) => {
    const container = getContainer()
    const service = container.resolve("inbound_emails") as any
    return service.createInboundEmails({
      imap_uid: `uid_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      message_id: `<msg_${Date.now()}@test.com>`,
      from_address: "orders@vendor.com",
      to_addresses: ["team@example.com"],
      subject: "Order Confirmation #12345",
      html_body:
        '<html><body><h1>Order Confirmed</h1>' +
        "<table>" +
        "<tr><td>Cotton Fabric</td><td>Qty: 10</td><td>$50.00</td></tr>" +
        "<tr><td>Silk Thread</td><td>Qty: 5</td><td>$25.00</td></tr>" +
        "</table>" +
        "<p>Subtotal: $525.00</p>" +
        "<p>Shipping: $15.00</p>" +
        "<p>Total: $540.00</p>" +
        '<p>Order #ORD-98765</p>' +
        '<p>Tracking #1Z999AA10123456784</p>' +
        "</body></html>",
      text_body:
        "Order Confirmed. Cotton Fabric x10 $50.00, Silk Thread x5 $25.00. Total: $540.00. Order #ORD-98765",
      folder: "INBOX",
      received_at: new Date(),
      status: "received",
      ...overrides,
    })
  }

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
  })

  // ─── Service-level CRUD (via container) ────────────────────────────────────

  describe("InboundEmail module service", () => {
    it("should create an inbound email record", async () => {
      const email = await createTestEmail()
      expect(email).toBeDefined()
      expect(email.id).toMatch(/^inb_email_/)
      expect(email.from_address).toBe("orders@vendor.com")
      expect(email.status).toBe("received")
    })

    it("should retrieve a single record by id", async () => {
      const created = await createTestEmail()
      const container = getContainer()
      const service = container.resolve("inbound_emails") as any
      const retrieved = await service.retrieveInboundEmail(created.id)
      expect(retrieved.id).toBe(created.id)
      expect(retrieved.subject).toBe(created.subject)
    })

    it("should list and count records with filters", async () => {
      await createTestEmail({ status: "received", imap_uid: "svc_1" })
      await createTestEmail({ status: "processed", imap_uid: "svc_2" })
      await createTestEmail({ status: "ignored", imap_uid: "svc_3" })

      const container = getContainer()
      const service = container.resolve("inbound_emails") as any
      const [emails, count] = await service.listAndCountInboundEmails(
        { status: "received" },
        { take: 10, skip: 0 }
      )
      expect(count).toBeGreaterThanOrEqual(1)
      for (const e of emails) {
        expect(e.status).toBe("received")
      }
    })

    it("should update an inbound email record", async () => {
      const email = await createTestEmail()
      const container = getContainer()
      const service = container.resolve("inbound_emails") as any

      const updated = await service.updateInboundEmails(email.id, {
        status: "ignored",
        action_type: "create_inventory_order",
      })
      expect(updated.status).toBe("ignored")
      expect(updated.action_type).toBe("create_inventory_order")
    })

    it("should delete an inbound email record", async () => {
      const email = await createTestEmail()
      const container = getContainer()
      const service = container.resolve("inbound_emails") as any

      await service.deleteInboundEmails(email.id)

      const retrieved = await service
        .retrieveInboundEmail(email.id)
        .catch((e: any) => null)
      expect(retrieved).toBeNull()
    })

    it("should store JSON fields correctly", async () => {
      const metadata = { source: "test", tags: ["a", "b"] }
      const email = await createTestEmail({ metadata })

      const container = getContainer()
      const service = container.resolve("inbound_emails") as any
      const retrieved = await service.retrieveInboundEmail(email.id)
      expect(retrieved.metadata).toEqual(metadata)
      expect(retrieved.to_addresses).toEqual(["team@example.com"])
    })

    it("should handle nullable fields correctly", async () => {
      const email = await createTestEmail({
        message_id: null,
        text_body: null,
        action_type: null,
        action_result: null,
        extracted_data: null,
        error_message: null,
        metadata: null,
      })
      expect(email.message_id).toBeNull()
      expect(email.text_body).toBeNull()
      expect(email.action_type).toBeNull()
    })
  })

  // ─── GET /admin/inbound-emails ─────────────────────────────────────────────

  describe("GET /admin/inbound-emails", () => {
    it("should return empty list when no emails exist", async () => {
      const res = await api.get("/admin/inbound-emails", headers)
      expect(res.status).toBe(200)
      expect(res.data.inbound_emails).toBeDefined()
      expect(Array.isArray(res.data.inbound_emails)).toBe(true)
      expect(res.data).toHaveProperty("count")
      expect(res.data).toHaveProperty("offset", 0)
      expect(res.data).toHaveProperty("limit", 20)
    })

    it("should return paginated list after creating records", async () => {
      await createTestEmail({ subject: "Order #001", imap_uid: "pg1" })
      await createTestEmail({ subject: "Order #002", imap_uid: "pg2" })
      await createTestEmail({ subject: "Order #003", imap_uid: "pg3" })
      await createTestEmail({ subject: "Order #004", imap_uid: "pg4" })

      const res = await api.get(
        "/admin/inbound-emails?limit=2&offset=0",
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.inbound_emails.length).toBeLessThanOrEqual(2)
      expect(res.data.count).toBeGreaterThanOrEqual(4)
      expect(res.data.offset).toBe(0)
      expect(res.data.limit).toBe(2)
    })

    it("should paginate with offset", async () => {
      await createTestEmail({ imap_uid: "off1" })
      await createTestEmail({ imap_uid: "off2" })
      await createTestEmail({ imap_uid: "off3" })

      const page1 = await api.get(
        "/admin/inbound-emails?limit=1&offset=0",
        headers
      )
      const page2 = await api.get(
        "/admin/inbound-emails?limit=1&offset=1",
        headers
      )
      expect(page1.status).toBe(200)
      expect(page2.status).toBe(200)
      expect(page1.data.inbound_emails.length).toBe(1)
      expect(page2.data.inbound_emails.length).toBe(1)
      // Different records
      expect(page1.data.inbound_emails[0].id).not.toBe(
        page2.data.inbound_emails[0].id
      )
    })

    it("should filter by status", async () => {
      await createTestEmail({ status: "received", imap_uid: "fs1" })
      await createTestEmail({ status: "processed", imap_uid: "fs2" })
      await createTestEmail({ status: "ignored", imap_uid: "fs3" })

      const res = await api.get(
        "/admin/inbound-emails?status=received",
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.inbound_emails.length).toBeGreaterThanOrEqual(1)
      for (const email of res.data.inbound_emails) {
        expect(email.status).toBe("received")
      }
    })

    it("should filter by from_address", async () => {
      await createTestEmail({
        from_address: "special@shop.com",
        imap_uid: "fa1",
      })
      await createTestEmail({
        from_address: "other@shop.com",
        imap_uid: "fa2",
      })

      const res = await api.get(
        "/admin/inbound-emails?from_address=special@shop.com",
        headers
      )
      expect(res.status).toBe(200)
      for (const email of res.data.inbound_emails) {
        expect(email.from_address).toBe("special@shop.com")
      }
    })

    it("should filter by folder", async () => {
      await createTestEmail({ folder: "INBOX", imap_uid: "fl1" })
      await createTestEmail({ folder: "Purchases", imap_uid: "fl2" })

      const res = await api.get(
        "/admin/inbound-emails?folder=Purchases",
        headers
      )
      expect(res.status).toBe(200)
      for (const email of res.data.inbound_emails) {
        expect(email.folder).toBe("Purchases")
      }
    })

    it("should search by subject via q parameter", async () => {
      await createTestEmail({
        subject: "Unique Fabric Order XYZ",
        imap_uid: "qs1",
      })
      await createTestEmail({
        subject: "Something Else",
        imap_uid: "qs2",
      })

      const res = await api.get(
        "/admin/inbound-emails?q=Fabric",
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.inbound_emails.length).toBeGreaterThanOrEqual(1)
      const subjects = res.data.inbound_emails.map((e: any) => e.subject)
      expect(subjects.some((s: string) => s.includes("Fabric"))).toBe(true)
    })

    it("should search by from_address via q parameter", async () => {
      await createTestEmail({
        from_address: "uniquesender@rare-domain.com",
        imap_uid: "qf1",
      })

      const res = await api.get(
        "/admin/inbound-emails?q=rare-domain",
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.inbound_emails.length).toBeGreaterThanOrEqual(1)
    })

    it("should not include html_body in list response", async () => {
      await createTestEmail({ imap_uid: "nohtmllist" })

      const res = await api.get("/admin/inbound-emails", headers)
      expect(res.status).toBe(200)
      expect(res.data.inbound_emails.length).toBeGreaterThanOrEqual(1)
      // List endpoint should omit heavy fields
      for (const email of res.data.inbound_emails) {
        expect(email.html_body).toBeUndefined()
        expect(email.text_body).toBeUndefined()
        expect(email.extracted_data).toBeUndefined()
        expect(email.action_result).toBeUndefined()
      }
    })

    it("should return 400 for invalid status filter", async () => {
      const res = await api
        .get("/admin/inbound-emails?status=invalid_status", headers)
        .catch((err) => err.response)
      expect(res.status).toBe(400)
    })

    it("should reject unauthenticated requests", async () => {
      const res = await api
        .get("/admin/inbound-emails")
        .catch((err) => err.response)
      expect(res.status).toBe(401)
    })
  })

  // ─── GET /admin/inbound-emails/:id ─────────────────────────────────────────

  describe("GET /admin/inbound-emails/:id", () => {
    it("should return full email detail including body", async () => {
      const email = await createTestEmail()

      const res = await api.get(
        `/admin/inbound-emails/${email.id}`,
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.inbound_email).toBeDefined()
      expect(res.data.inbound_email.id).toBe(email.id)
      expect(res.data.inbound_email.html_body).toBeDefined()
      expect(res.data.inbound_email.text_body).toBeDefined()
      expect(res.data.inbound_email.from_address).toBe("orders@vendor.com")
      expect(res.data.inbound_email.subject).toContain("Order Confirmation")
      expect(res.data.inbound_email.to_addresses).toEqual(["team@example.com"])
      expect(res.data.inbound_email.folder).toBe("INBOX")
      expect(res.data.inbound_email.status).toBe("received")
    })

    it("should return 404 for non-existent ID", async () => {
      const res = await api
        .get("/admin/inbound-emails/inb_email_nonexistent999", headers)
        .catch((err) => err.response)
      expect(res.status).toBe(404)
    })

    it("should return 401 without auth", async () => {
      const email = await createTestEmail()
      const res = await api
        .get(`/admin/inbound-emails/${email.id}`)
        .catch((err) => err.response)
      expect(res.status).toBe(401)
    })
  })

  // ─── POST /admin/inbound-emails/:id/extract ────────────────────────────────

  describe("POST /admin/inbound-emails/:id/extract", () => {
    it("should extract order data from email HTML", async () => {
      const email = await createTestEmail()

      const res = await api.post(
        `/admin/inbound-emails/${email.id}/extract`,
        { action_type: "create_inventory_order" },
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.extracted_data).toBeDefined()
      expect(res.data.action_type).toBe("create_inventory_order")
      expect(res.data.inbound_email_id).toBe(email.id)

      // Check extracted fields
      const data = res.data.extracted_data
      expect(data).toHaveProperty("vendor")
      expect(data).toHaveProperty("items")
      expect(data).toHaveProperty("total")
      expect(data.order_number).toBe("ORD-98765")
      expect(data.currency).toBe("USD")
    })

    it("should update email status to action_pending after extraction", async () => {
      const email = await createTestEmail()

      await api.post(
        `/admin/inbound-emails/${email.id}/extract`,
        { action_type: "create_inventory_order" },
        headers
      )

      // Verify status updated
      const detail = await api.get(
        `/admin/inbound-emails/${email.id}`,
        headers
      )
      expect(detail.data.inbound_email.status).toBe("action_pending")
      expect(detail.data.inbound_email.action_type).toBe(
        "create_inventory_order"
      )
      expect(detail.data.inbound_email.extracted_data).toBeDefined()
    })

    it("should return error for unknown action type", async () => {
      const email = await createTestEmail()

      const res = await api
        .post(
          `/admin/inbound-emails/${email.id}/extract`,
          { action_type: "nonexistent_action" },
          headers
        )
        .catch((err) => err.response)
      expect(res.status).toBe(400)
    })

    it("should return 400 when action_type is missing", async () => {
      const email = await createTestEmail()

      const res = await api
        .post(`/admin/inbound-emails/${email.id}/extract`, {}, headers)
        .catch((err) => err.response)
      expect(res.status).toBe(400)
    })

    it("should return 404 for non-existent email", async () => {
      const res = await api
        .post(
          "/admin/inbound-emails/inb_email_nonexistent/extract",
          { action_type: "create_inventory_order" },
          headers
        )
        .catch((err) => err.response)
      expect(res.status).toBe(404)
    })

    it("should extract items from table-based HTML", async () => {
      const email = await createTestEmail()

      const res = await api.post(
        `/admin/inbound-emails/${email.id}/extract`,
        { action_type: "create_inventory_order" },
        headers
      )
      expect(res.status).toBe(200)
      const items = res.data.extracted_data.items
      expect(Array.isArray(items)).toBe(true)
      // Our test HTML has two table rows with items
      expect(items.length).toBeGreaterThanOrEqual(1)
    })

    it("should be idempotent (extracting twice returns same data)", async () => {
      const email = await createTestEmail()

      const res1 = await api.post(
        `/admin/inbound-emails/${email.id}/extract`,
        { action_type: "create_inventory_order" },
        headers
      )
      const res2 = await api.post(
        `/admin/inbound-emails/${email.id}/extract`,
        { action_type: "create_inventory_order" },
        headers
      )
      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)
      expect(res1.data.extracted_data.order_number).toBe(
        res2.data.extracted_data.order_number
      )
    })
  })

  // ─── POST /admin/inbound-emails/:id/ignore ─────────────────────────────────

  describe("POST /admin/inbound-emails/:id/ignore", () => {
    it("should set status to ignored", async () => {
      const email = await createTestEmail()

      const res = await api.post(
        `/admin/inbound-emails/${email.id}/ignore`,
        {},
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.status).toBe("ignored")
      expect(res.data.inbound_email_id).toBe(email.id)
    })

    it("should persist ignored status", async () => {
      const email = await createTestEmail()

      await api.post(
        `/admin/inbound-emails/${email.id}/ignore`,
        {},
        headers
      )

      const detail = await api.get(
        `/admin/inbound-emails/${email.id}`,
        headers
      )
      expect(detail.data.inbound_email.status).toBe("ignored")
    })

    it("should be idempotent (ignoring already ignored email)", async () => {
      const email = await createTestEmail({ status: "ignored" })

      const res = await api.post(
        `/admin/inbound-emails/${email.id}/ignore`,
        {},
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.status).toBe("ignored")
    })

    it("should return 404 for non-existent email", async () => {
      const res = await api
        .post(
          "/admin/inbound-emails/inb_email_nonexistent/ignore",
          {},
          headers
        )
        .catch((err) => err.response)
      expect(res.status).toBe(404)
    })

    it("should work on emails with any prior status", async () => {
      const email = await createTestEmail({ status: "action_pending" })

      const res = await api.post(
        `/admin/inbound-emails/${email.id}/ignore`,
        {},
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.status).toBe("ignored")
    })
  })

  // ─── GET /admin/inbound-emails/actions ─────────────────────────────────────

  describe("GET /admin/inbound-emails/actions", () => {
    it("should list available actions", async () => {
      const res = await api.get("/admin/inbound-emails/actions", headers)
      expect(res.status).toBe(200)
      expect(res.data.actions).toBeDefined()
      expect(Array.isArray(res.data.actions)).toBe(true)
      expect(res.data.actions.length).toBeGreaterThanOrEqual(1)
    })

    it("should include create_inventory_order action with metadata", async () => {
      const res = await api.get("/admin/inbound-emails/actions", headers)
      expect(res.status).toBe(200)

      const action = res.data.actions.find(
        (a: any) => a.type === "create_inventory_order"
      )
      expect(action).toBeDefined()
      expect(action.label).toBeDefined()
      expect(action.description).toBeDefined()
      expect(typeof action.label).toBe("string")
      expect(typeof action.description).toBe("string")
    })

    it("should not expose internal action functions", async () => {
      const res = await api.get("/admin/inbound-emails/actions", headers)
      expect(res.status).toBe(200)

      for (const action of res.data.actions) {
        expect(action.extract).toBeUndefined()
        expect(action.execute).toBeUndefined()
        // Only type, label, description should be returned
        expect(Object.keys(action).sort()).toEqual(
          ["description", "label", "type"]
        )
      }
    })
  })

  // ─── POST /admin/inbound-emails/:id/execute ────────────────────────────────

  describe("POST /admin/inbound-emails/:id/execute", () => {
    it("should return 400 when action_type is missing", async () => {
      const email = await createTestEmail()

      const res = await api
        .post(
          `/admin/inbound-emails/${email.id}/execute`,
          { params: {} },
          headers
        )
        .catch((err) => err.response)
      expect(res.status).toBe(400)
    })

    it("should return 400 when params is missing", async () => {
      const email = await createTestEmail()

      const res = await api
        .post(
          `/admin/inbound-emails/${email.id}/execute`,
          { action_type: "create_inventory_order" },
          headers
        )
        .catch((err) => err.response)
      expect(res.status).toBe(400)
    })

    it("should return 400 for unknown action type", async () => {
      const email = await createTestEmail()

      const res = await api
        .post(
          `/admin/inbound-emails/${email.id}/execute`,
          { action_type: "nonexistent", params: {} },
          headers
        )
        .catch((err) => err.response)
      expect(res.status).toBe(400)
    })

    it("should return 404 for non-existent email", async () => {
      const res = await api
        .post(
          "/admin/inbound-emails/inb_email_nonexistent/execute",
          {
            action_type: "create_inventory_order",
            params: { stock_location_id: "sloc_123", item_mappings: [] },
          },
          headers
        )
        .catch((err) => err.response)
      expect(res.status).toBe(404)
    })
  })

  // ─── POST /admin/inbound-emails/sync ───────────────────────────────────────

  describe("POST /admin/inbound-emails/sync", () => {
    it("should return error when IMAP is not configured", async () => {
      // In the test environment, IMAP env vars are not set
      const res = await api
        .post("/admin/inbound-emails/sync", { count: 10 }, headers)
        .catch((err) => err.response)
      // Expect either 400 or 500 depending on error type
      expect([400, 500]).toContain(res.status)
    })

    it("should accept count parameter", async () => {
      // Even though IMAP is not configured, validation should pass
      const res = await api
        .post("/admin/inbound-emails/sync", { count: 25 }, headers)
        .catch((err) => err.response)
      // Should fail at IMAP connection, not at validation
      expect(res.data).toBeDefined()
    })
  })

  // ─── End-to-end: extract → verify → status lifecycle ──────────────────────

  describe("Email lifecycle: received → extract → action_pending", () => {
    it("should transition through statuses correctly", async () => {
      // 1. Create email (status: received)
      const email = await createTestEmail()

      const listRes = await api.get(
        `/admin/inbound-emails?status=received`,
        headers
      )
      expect(listRes.data.inbound_emails.some((e: any) => e.id === email.id)).toBe(
        true
      )

      // 2. Extract (status → action_pending)
      const extractRes = await api.post(
        `/admin/inbound-emails/${email.id}/extract`,
        { action_type: "create_inventory_order" },
        headers
      )
      expect(extractRes.status).toBe(200)
      expect(extractRes.data.extracted_data.order_number).toBe("ORD-98765")

      const detailAfterExtract = await api.get(
        `/admin/inbound-emails/${email.id}`,
        headers
      )
      expect(detailAfterExtract.data.inbound_email.status).toBe("action_pending")
      expect(detailAfterExtract.data.inbound_email.action_type).toBe(
        "create_inventory_order"
      )

      // 3. Now it should show up under action_pending filter
      const pendingRes = await api.get(
        `/admin/inbound-emails?status=action_pending`,
        headers
      )
      expect(
        pendingRes.data.inbound_emails.some((e: any) => e.id === email.id)
      ).toBe(true)

      // 4. Ignore instead of executing
      const ignoreRes = await api.post(
        `/admin/inbound-emails/${email.id}/ignore`,
        {},
        headers
      )
      expect(ignoreRes.status).toBe(200)

      const detailAfterIgnore = await api.get(
        `/admin/inbound-emails/${email.id}`,
        headers
      )
      expect(detailAfterIgnore.data.inbound_email.status).toBe("ignored")
    })
  })

  // ─── Edge cases / validation ───────────────────────────────────────────────

  describe("Edge cases", () => {
    it("should handle emails with minimal HTML body", async () => {
      const email = await createTestEmail({
        html_body: "<p>Simple text</p>",
        text_body: "Simple text",
        imap_uid: "minimal1",
      })

      const res = await api.post(
        `/admin/inbound-emails/${email.id}/extract`,
        { action_type: "create_inventory_order" },
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.extracted_data).toBeDefined()
      // Items should be empty since there's no table
      expect(res.data.extracted_data.items).toEqual([])
    })

    it("should handle emails with empty HTML body", async () => {
      const email = await createTestEmail({
        html_body: "",
        text_body: "",
        imap_uid: "empty1",
      })

      const res = await api.post(
        `/admin/inbound-emails/${email.id}/extract`,
        { action_type: "create_inventory_order" },
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.extracted_data.items).toEqual([])
      expect(res.data.extracted_data.total).toBeNull()
    })

    it("should handle concurrent requests to the same email", async () => {
      const email = await createTestEmail({ imap_uid: "concurrent1" })

      const [res1, res2] = await Promise.all([
        api.post(
          `/admin/inbound-emails/${email.id}/extract`,
          { action_type: "create_inventory_order" },
          headers
        ),
        api.get(`/admin/inbound-emails/${email.id}`, headers),
      ])
      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)
    })

    it("should handle special characters in from_address", async () => {
      const email = await createTestEmail({
        from_address: "user+tag@sub.domain.co.uk",
        imap_uid: "specialaddr1",
      })

      const res = await api.get(
        `/admin/inbound-emails/${email.id}`,
        headers
      )
      expect(res.data.inbound_email.from_address).toBe(
        "user+tag@sub.domain.co.uk"
      )
    })

    it("should handle very long subjects", async () => {
      const longSubject = "A".repeat(500)
      const email = await createTestEmail({
        subject: longSubject,
        imap_uid: "longsubj1",
      })

      const res = await api.get(
        `/admin/inbound-emails/${email.id}`,
        headers
      )
      expect(res.data.inbound_email.subject).toBe(longSubject)
    })
  })
})
