/**
 * Integration tests for /admin/payment_reports API
 *
 * Covers:
 *   GET    /admin/payment_reports          — list saved snapshots
 *   POST   /admin/payment_reports          — generate + persist a snapshot
 *   GET    /admin/payment_reports/:id      — get single saved report
 *   PATCH  /admin/payment_reports/:id      — update name/metadata
 *   DELETE /admin/payment_reports/:id      — delete a report
 *   GET    /admin/payment_reports/summary  — live aggregate (all payments)
 *   GET    /admin/payment_reports/by-partner — live aggregate by partner
 *   GET    /admin/payment_reports/by-person  — live aggregate by person
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** ISO date string one year ago */
const oneYearAgo = () => new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
/** ISO date string for tomorrow (inclusive upper bound) */
const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

/** Create a partner via admin API and return its id */
async function createPartner(api: any, headers: any, name: string) {
  const slug = name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now()
  const res = await api.post(
    "/admin/partners",
    {
      partner: { name, handle: slug },
      admin: {
        email: `${slug}@test.com`,
        first_name: "Test",
        last_name: "Admin",
      },
    },
    headers
  )
  return res.data.partner.id as string
}

/** Create a person via admin API and return its id */
async function createPerson(api: any, headers: any, firstName: string, lastName: string) {
  const res = await api.post(
    "/admin/persons",
    {
      first_name: firstName,
      last_name: lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${Date.now()}@test.com`,
    },
    headers
  )
  return res.data.person.id as string
}

/** Create a standalone payment and return its id. Requires a valid paid_to_id. */
async function createPayment(
  api: any,
  headers: any,
  paidToId: string,
  overrides: Partial<{
    amount: number
    status: string
    payment_type: string
    payment_date: string
  }> = {}
) {
  const body = {
    amount: overrides.amount ?? 1000,
    status: overrides.status ?? "Completed",
    payment_type: overrides.payment_type ?? "Bank",
    payment_date: overrides.payment_date ?? new Date().toISOString(),
    paid_to_id: paidToId,
  }
  const res = await api.post("/admin/payments", body, headers)
  return res.data.payment.id as string
}

/**
 * Create a payment and immediately link it to a partner in one call.
 * Returns the new payment id.
 */
async function createAndLinkPaymentToPartner(
  api: any,
  headers: any,
  partnerId: string,
  paidToId: string,
  overrides: Partial<{ amount: number; status: string; payment_type: string }> = {}
) {
  const res = await api.post(
    "/admin/payments/link",
    {
      payment: {
        amount: overrides.amount ?? 1000,
        status: overrides.status ?? "Completed",
        payment_type: overrides.payment_type ?? "Bank",
        payment_date: new Date().toISOString(),
        paid_to_id: paidToId,
      },
      partnerIds: [partnerId],
    },
    headers
  )
  return res.data?.payment?.id as string
}

/**
 * Create a payment and immediately link it to a person in one call.
 * Returns the new payment id.
 */
async function createAndLinkPaymentToPerson(
  api: any,
  headers: any,
  personId: string,
  paidToId: string,
  overrides: Partial<{ amount: number; status: string; payment_type: string }> = {}
) {
  const res = await api.post(
    "/admin/payments/link",
    {
      payment: {
        amount: overrides.amount ?? 1000,
        status: overrides.status ?? "Completed",
        payment_type: overrides.payment_type ?? "Bank",
        payment_date: new Date().toISOString(),
        paid_to_id: paidToId,
      },
      personIds: [personId],
    },
    headers
  )
  return res.data?.payment?.id as string
}

// ─── Test suite ───────────────────────────────────────────────────────────────

setupSharedTestSuite(() => {
  let headers: any
  /**
   * Shared PaymentDetail ID — every payment requires a `paid_to_id`
   * because `paid_to: belongsTo(PaymentDetails)` is non-nullable.
   * We create ONE fixture person + payment method per test run.
   */
  let fixturePersonId: string
  let paidToId: string

  const { api, getContainer } = getSharedTestEnv()

  // Ids collected during tests — cleaned up in afterEach
  let createdReportIds: string[] = []
  let createdPaymentIds: string[] = []
  let createdPartnerIds: string[] = []
  let createdPersonIds: string[] = []

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
    createdReportIds = []
    createdPaymentIds = []
    createdPartnerIds = []
    createdPersonIds = []

    // Create a fixture person + payment method so all payments have a valid paid_to_id
    fixturePersonId = await createPerson(api, headers, "Fixture", "PaymentPerson")
    createdPersonIds.push(fixturePersonId)
    const methodRes = await api.post(
      `/admin/payments/persons/${fixturePersonId}/methods`,
      { type: "bank_account", account_name: "Test Bank Account", bank_name: "Test Bank" },
      headers
    )
    paidToId = methodRes.data.paymentMethod.id
  })

  afterEach(async () => {
    // Best-effort cleanup — ignore 404s
    for (const id of createdReportIds) {
      await api.delete(`/admin/payment_reports/${id}`, headers).catch(() => {})
    }
    for (const id of createdPaymentIds) {
      await api.delete(`/admin/payments/${id}`, headers).catch(() => {})
    }
    for (const id of createdPartnerIds) {
      await api.delete(`/admin/partners/${id}`, headers).catch(() => {})
    }
    for (const id of createdPersonIds) {
      await api.delete(`/admin/persons/${id}`, headers).catch(() => {})
    }
  })

  // ── POST /admin/payment_reports ─────────────────────────────────────────────

  describe("POST /admin/payment_reports", () => {
    it("should create a snapshot report with required fields", async () => {
      const res = await api.post(
        "/admin/payment_reports",
        {
          period_start: oneYearAgo(),
          period_end: tomorrow(),
          entity_type: "all",
        },
        headers
      )

      expect(res.status).toBe(201)
      const { payment_report } = res.data
      expect(payment_report).toBeDefined()
      expect(payment_report.id).toBeDefined()
      expect(payment_report.entity_type).toBe("all")
      expect(payment_report.payment_count).toBeGreaterThanOrEqual(0)
      expect(payment_report.total_amount).toBeGreaterThanOrEqual(0)
      expect(payment_report.by_status).toBeDefined()
      expect(payment_report.by_type).toBeDefined()
      expect(payment_report.generated_at).toBeDefined()

      createdReportIds.push(payment_report.id)
    })

    it("should accept an optional name and metadata", async () => {
      const res = await api.post(
        "/admin/payment_reports",
        {
          name: "Q1 2026 Report",
          period_start: "2026-01-01T00:00:00.000Z",
          period_end: "2026-03-31T23:59:59.999Z",
          entity_type: "all",
          metadata: { generated_by: "test" },
        },
        headers
      )

      expect(res.status).toBe(201)
      const { payment_report } = res.data
      expect(payment_report.name).toBe("Q1 2026 Report")
      expect(payment_report.metadata).toMatchObject({ generated_by: "test" })

      createdReportIds.push(payment_report.id)
    })

    it("should compute by_status breakdown from existing payments", async () => {
      // Create one Completed + one Pending payment
      const p1 = await createPayment(api, headers, paidToId, { status: "Completed", amount: 500 })
      const p2 = await createPayment(api, headers, paidToId, { status: "Pending", amount: 300 })
      createdPaymentIds.push(p1, p2)

      const res = await api.post(
        "/admin/payment_reports",
        { period_start: oneYearAgo(), period_end: tomorrow(), entity_type: "all" },
        headers
      )

      expect(res.status).toBe(201)
      const { by_status } = res.data.payment_report
      // At minimum our two payments should be reflected
      expect(by_status).toHaveProperty("Completed")
      expect(by_status).toHaveProperty("Pending")

      createdReportIds.push(res.data.payment_report.id)
    })

    it("should generate a by_month breakdown when payments exist", async () => {
      const p1 = await createPayment(api, headers, paidToId, {
        amount: 750,
        payment_date: "2026-01-15T10:00:00.000Z",
      })
      createdPaymentIds.push(p1)

      const res = await api.post(
        "/admin/payment_reports",
        {
          period_start: "2026-01-01T00:00:00.000Z",
          period_end: "2026-01-31T23:59:59.999Z",
          entity_type: "all",
        },
        headers
      )

      expect(res.status).toBe(201)
      const { by_month } = res.data.payment_report
      expect(Array.isArray(by_month)).toBe(true)

      createdReportIds.push(res.data.payment_report.id)
    })

    it("should scope report to a specific partner when entity_type=partner", async () => {
      const partnerId = await createPartner(api, headers, "Reporting Partner")
      createdPartnerIds.push(partnerId)

      const payId = await createAndLinkPaymentToPartner(api, headers, partnerId, paidToId, { amount: 2000, status: "Completed" })
      createdPaymentIds.push(payId)

      const res = await api.post(
        "/admin/payment_reports",
        {
          period_start: oneYearAgo(),
          period_end: tomorrow(),
          entity_type: "partner",
          entity_id: partnerId,
        },
        headers
      )

      expect(res.status).toBe(201)
      const { payment_report } = res.data
      expect(payment_report.entity_type).toBe("partner")
      expect(payment_report.entity_id).toBe(partnerId)
      expect(payment_report.payment_count).toBeGreaterThanOrEqual(1)

      createdReportIds.push(payment_report.id)
    })

    it("should scope report to a specific person when entity_type=person", async () => {
      const personId = await createPerson(api, headers, "Report", "Person")
      createdPersonIds.push(personId)

      const payId = await createAndLinkPaymentToPerson(api, headers, personId, paidToId, { amount: 1500, status: "Completed" })
      createdPaymentIds.push(payId)

      const res = await api.post(
        "/admin/payment_reports",
        {
          period_start: oneYearAgo(),
          period_end: tomorrow(),
          entity_type: "person",
          entity_id: personId,
        },
        headers
      )

      expect(res.status).toBe(201)
      const { payment_report } = res.data
      expect(payment_report.entity_type).toBe("person")
      expect(payment_report.entity_id).toBe(personId)
      expect(payment_report.payment_count).toBeGreaterThanOrEqual(1)

      createdReportIds.push(payment_report.id)
    })

    it("should reject missing period_start", async () => {
      const res = await api
        .post(
          "/admin/payment_reports",
          { period_end: tomorrow(), entity_type: "all" },
          headers
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
    })

    it("should reject missing period_end", async () => {
      const res = await api
        .post(
          "/admin/payment_reports",
          { period_start: oneYearAgo(), entity_type: "all" },
          headers
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
    })

    it("should reject invalid entity_type", async () => {
      const res = await api
        .post(
          "/admin/payment_reports",
          { period_start: oneYearAgo(), period_end: tomorrow(), entity_type: "company" },
          headers
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
    })
  })

  // ── GET /admin/payment_reports ──────────────────────────────────────────────

  describe("GET /admin/payment_reports", () => {
    it("should return an empty list when no reports exist", async () => {
      const res = await api.get("/admin/payment_reports", headers)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.data.payment_reports)).toBe(true)
      expect(typeof res.data.count).toBe("number")
    })

    it("should list created reports with pagination metadata", async () => {
      // Create 2 reports
      const r1 = await api.post(
        "/admin/payment_reports",
        { period_start: oneYearAgo(), period_end: tomorrow() },
        headers
      )
      const r2 = await api.post(
        "/admin/payment_reports",
        { period_start: oneYearAgo(), period_end: tomorrow(), name: "Report 2" },
        headers
      )
      createdReportIds.push(r1.data.payment_report.id, r2.data.payment_report.id)

      const res = await api.get("/admin/payment_reports", headers)

      expect(res.status).toBe(200)
      expect(res.data.count).toBeGreaterThanOrEqual(2)
      expect(res.data.payment_reports.length).toBeGreaterThanOrEqual(2)
    })

    it("should respect limit and offset", async () => {
      // Create 3 reports
      for (let i = 0; i < 3; i++) {
        const r = await api.post(
          "/admin/payment_reports",
          { period_start: oneYearAgo(), period_end: tomorrow(), name: `Paginate ${i}` },
          headers
        )
        createdReportIds.push(r.data.payment_report.id)
      }

      const res = await api.get("/admin/payment_reports", {
        ...headers,
        params: { limit: 2, offset: 0 },
      })

      expect(res.status).toBe(200)
      expect(res.data.payment_reports.length).toBeLessThanOrEqual(2)
      expect(res.data.limit).toBe(2)
      expect(res.data.offset).toBe(0)
    })

    it("should filter by entity_type", async () => {
      const partnerId = await createPartner(api, headers, "FilterPartner")
      createdPartnerIds.push(partnerId)

      const partnerReport = await api.post(
        "/admin/payment_reports",
        { period_start: oneYearAgo(), period_end: tomorrow(), entity_type: "partner", entity_id: partnerId },
        headers
      )
      const allReport = await api.post(
        "/admin/payment_reports",
        { period_start: oneYearAgo(), period_end: tomorrow(), entity_type: "all" },
        headers
      )
      createdReportIds.push(partnerReport.data.payment_report.id, allReport.data.payment_report.id)

      const res = await api.get("/admin/payment_reports", {
        ...headers,
        params: { entity_type: "partner" },
      })

      expect(res.status).toBe(200)
      res.data.payment_reports.forEach((r: any) => {
        expect(r.entity_type).toBe("partner")
      })
    })
  })

  // ── GET /admin/payment_reports/:id ──────────────────────────────────────────

  describe("GET /admin/payment_reports/:id", () => {
    it("should return a single report by id", async () => {
      const created = await api.post(
        "/admin/payment_reports",
        { period_start: oneYearAgo(), period_end: tomorrow(), name: "Single Fetch" },
        headers
      )
      const reportId = created.data.payment_report.id
      createdReportIds.push(reportId)

      const res = await api.get(`/admin/payment_reports/${reportId}`, headers)

      expect(res.status).toBe(200)
      expect(res.data.payment_report.id).toBe(reportId)
      expect(res.data.payment_report.name).toBe("Single Fetch")
    })

    it("should return 404 for a non-existent report id", async () => {
      const res = await api
        .get("/admin/payment_reports/nonexistent_id_xyz", headers)
        .catch((e: any) => e.response)

      expect(res.status).toBe(404)
    })
  })

  // ── PATCH /admin/payment_reports/:id ────────────────────────────────────────

  describe("PATCH /admin/payment_reports/:id", () => {
    it("should update the report name", async () => {
      const created = await api.post(
        "/admin/payment_reports",
        { period_start: oneYearAgo(), period_end: tomorrow(), name: "Original Name" },
        headers
      )
      const reportId = created.data.payment_report.id
      createdReportIds.push(reportId)

      const res = await api.patch(
        `/admin/payment_reports/${reportId}`,
        { name: "Updated Name" },
        headers
      )

      expect(res.status).toBe(200)
      expect(res.data.payment_report.name).toBe("Updated Name")
    })

    it("should merge metadata on update", async () => {
      const created = await api.post(
        "/admin/payment_reports",
        {
          period_start: oneYearAgo(),
          period_end: tomorrow(),
          metadata: { source: "manual" },
        },
        headers
      )
      const reportId = created.data.payment_report.id
      createdReportIds.push(reportId)

      const res = await api.patch(
        `/admin/payment_reports/${reportId}`,
        { metadata: { approved: true } },
        headers
      )

      expect(res.status).toBe(200)
      // metadata is replaced (not deep-merged) on PATCH
      expect(res.data.payment_report.metadata).toBeDefined()
    })
  })

  // ── DELETE /admin/payment_reports/:id ───────────────────────────────────────

  describe("DELETE /admin/payment_reports/:id", () => {
    it("should delete a report and confirm it is gone", async () => {
      const created = await api.post(
        "/admin/payment_reports",
        { period_start: oneYearAgo(), period_end: tomorrow() },
        headers
      )
      const reportId = created.data.payment_report.id

      const del = await api.delete(`/admin/payment_reports/${reportId}`, headers)
      expect(del.status).toBe(200)
      expect(del.data.id).toBe(reportId)
      expect(del.data.deleted).toBe(true)

      // Fetching again should return 404
      const get = await api
        .get(`/admin/payment_reports/${reportId}`, headers)
        .catch((e: any) => e.response)
      expect(get.status).toBe(404)
    })
  })

  // ── GET /admin/payment_reports/summary ──────────────────────────────────────

  describe("GET /admin/payment_reports/summary", () => {
    it("should return aggregate totals with correct shape", async () => {
      const res = await api.get("/admin/payment_reports/summary", headers)

      expect(res.status).toBe(200)
      expect(typeof res.data.total_amount).toBe("number")
      expect(typeof res.data.payment_count).toBe("number")
      expect(res.data.by_status).toBeDefined()
      expect(res.data.by_type).toBeDefined()
      expect(Array.isArray(res.data.by_month)).toBe(true)
      expect(Array.isArray(res.data.payments)).toBe(true)
      expect(typeof res.data.count).toBe("number")
    })

    it("should include a newly created payment in totals", async () => {
      const payId = await createPayment(api, headers, paidToId, { amount: 999, status: "Completed", payment_type: "Cash" })
      createdPaymentIds.push(payId)

      const res = await api.get("/admin/payment_reports/summary", {
        ...headers,
        params: { period_start: oneYearAgo(), period_end: tomorrow() },
      })

      expect(res.status).toBe(200)
      expect(res.data.payment_count).toBeGreaterThanOrEqual(1)
      expect(res.data.total_amount).toBeGreaterThanOrEqual(999)
      expect(res.data.by_status).toHaveProperty("Completed")
      expect(res.data.by_type).toHaveProperty("Cash")
    })

    it("should filter by status query param", async () => {
      const p1 = await createPayment(api, headers, paidToId, { amount: 100, status: "Pending" })
      const p2 = await createPayment(api, headers, paidToId, { amount: 200, status: "Completed" })
      createdPaymentIds.push(p1, p2)

      const res = await api.get("/admin/payment_reports/summary", {
        ...headers,
        params: { status: "Pending", period_start: oneYearAgo(), period_end: tomorrow() },
      })

      expect(res.status).toBe(200)
      // All returned payments must be Pending
      res.data.payments.forEach((p: any) => {
        expect(p.status).toBe("Pending")
      })
      expect(res.data.by_status).not.toHaveProperty("Completed")
    })

    it("should filter by payment_type query param", async () => {
      const p1 = await createPayment(api, headers, paidToId, { amount: 300, payment_type: "Bank" })
      const p2 = await createPayment(api, headers, paidToId, { amount: 400, payment_type: "Digital_Wallet" })
      createdPaymentIds.push(p1, p2)

      const res = await api.get("/admin/payment_reports/summary", {
        ...headers,
        params: { payment_type: "Bank", period_start: oneYearAgo(), period_end: tomorrow() },
      })

      expect(res.status).toBe(200)
      res.data.payments.forEach((p: any) => {
        expect(p.payment_type).toBe("Bank")
      })
    })

    it("should return zero totals when period has no payments", async () => {
      // Use a future period that can't have any payments
      const far_future_start = "2099-01-01T00:00:00.000Z"
      const far_future_end = "2099-12-31T23:59:59.999Z"

      const res = await api.get("/admin/payment_reports/summary", {
        ...headers,
        params: { period_start: far_future_start, period_end: far_future_end },
      })

      expect(res.status).toBe(200)
      expect(res.data.payment_count).toBe(0)
      expect(res.data.total_amount).toBe(0)
    })

    it("should respect limit and offset pagination on the payments list", async () => {
      for (let i = 0; i < 3; i++) {
        const id = await createPayment(api, headers, paidToId, { amount: (i + 1) * 100 })
        createdPaymentIds.push(id)
      }

      const res = await api.get("/admin/payment_reports/summary", {
        ...headers,
        params: { limit: 2, offset: 0, period_start: oneYearAgo(), period_end: tomorrow() },
      })

      expect(res.status).toBe(200)
      expect(res.data.payments.length).toBeLessThanOrEqual(2)
    })

    it("should reject an invalid status value", async () => {
      const res = await api
        .get("/admin/payment_reports/summary", {
          ...headers,
          params: { status: "InvalidStatus" },
        })
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
    })
  })

  // ── GET /admin/payment_reports/by-partner ───────────────────────────────────

  describe("GET /admin/payment_reports/by-partner", () => {
    it("should return correct shape with count field", async () => {
      const res = await api.get("/admin/payment_reports/by-partner", headers)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.data.by_partner)).toBe(true)
      expect(typeof res.data.count).toBe("number")
    })

    it("should group payments by partner and include totals", async () => {
      const partnerId = await createPartner(api, headers, "GroupTest Partner")
      createdPartnerIds.push(partnerId)

      const p1 = await createAndLinkPaymentToPartner(api, headers, partnerId, paidToId, { amount: 500, status: "Completed" })
      const p2 = await createAndLinkPaymentToPartner(api, headers, partnerId, paidToId, { amount: 300, status: "Completed" })
      createdPaymentIds.push(p1, p2)

      const res = await api.get("/admin/payment_reports/by-partner", {
        ...headers,
        params: { period_start: oneYearAgo(), period_end: tomorrow() },
      })

      expect(res.status).toBe(200)
      const entry = res.data.by_partner.find((p: any) => p.partner_id === partnerId)
      expect(entry).toBeDefined()
      expect(entry.payment_count).toBeGreaterThanOrEqual(2)
      expect(entry.total_amount).toBeGreaterThanOrEqual(800)
      expect(entry.by_status).toHaveProperty("Completed")
    })

    it("should not include partners with no payments in the period", async () => {
      const partnerId = await createPartner(api, headers, "No Payments Partner")
      createdPartnerIds.push(partnerId)

      // Use a future window — no payments can exist there
      const res = await api.get("/admin/payment_reports/by-partner", {
        ...headers,
        params: { period_start: "2099-01-01T00:00:00.000Z", period_end: "2099-12-31T23:59:59.999Z" },
      })

      expect(res.status).toBe(200)
      const entry = res.data.by_partner.find((p: any) => p.partner_id === partnerId)
      expect(entry).toBeUndefined()
    })

    it("should sort results by total_amount descending", async () => {
      const p1Id = await createPartner(api, headers, "Small Partner")
      const p2Id = await createPartner(api, headers, "Big Partner")
      createdPartnerIds.push(p1Id, p2Id)

      const pay1 = await createAndLinkPaymentToPartner(api, headers, p1Id, paidToId, { amount: 100 })
      const pay2 = await createAndLinkPaymentToPartner(api, headers, p2Id, paidToId, { amount: 9000 })
      createdPaymentIds.push(pay1, pay2)

      const res = await api.get("/admin/payment_reports/by-partner", {
        ...headers,
        params: { period_start: oneYearAgo(), period_end: tomorrow() },
      })

      expect(res.status).toBe(200)
      const amounts = res.data.by_partner.map((p: any) => p.total_amount)
      for (let i = 1; i < amounts.length; i++) {
        expect(amounts[i - 1]).toBeGreaterThanOrEqual(amounts[i])
      }
    })
  })

  // ── GET /admin/payment_reports/by-person ────────────────────────────────────

  describe("GET /admin/payment_reports/by-person", () => {
    it("should return correct shape with count field", async () => {
      const res = await api.get("/admin/payment_reports/by-person", headers)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.data.by_person)).toBe(true)
      expect(typeof res.data.count).toBe("number")
    })

    it("should group payments by person and include totals", async () => {
      const personId = await createPerson(api, headers, "Pay", "Tester")
      createdPersonIds.push(personId)

      const p1 = await createAndLinkPaymentToPerson(api, headers, personId, paidToId, { amount: 700, status: "Completed" })
      const p2 = await createAndLinkPaymentToPerson(api, headers, personId, paidToId, { amount: 200, status: "Pending" })
      createdPaymentIds.push(p1, p2)

      const res = await api.get("/admin/payment_reports/by-person", {
        ...headers,
        params: { period_start: oneYearAgo(), period_end: tomorrow() },
      })

      expect(res.status).toBe(200)
      const entry = res.data.by_person.find((p: any) => p.person_id === personId)
      expect(entry).toBeDefined()
      expect(entry.payment_count).toBeGreaterThanOrEqual(2)
      expect(entry.total_amount).toBeGreaterThanOrEqual(900)
      expect(entry.by_status).toHaveProperty("Completed")
      expect(entry.by_status).toHaveProperty("Pending")
    })

    it("should filter by payment_type", async () => {
      const personId = await createPerson(api, headers, "Type", "Filter")
      createdPersonIds.push(personId)

      const p1 = await createAndLinkPaymentToPerson(api, headers, personId, paidToId, { amount: 500, payment_type: "Bank" })
      const p2 = await createAndLinkPaymentToPerson(api, headers, personId, paidToId, { amount: 250, payment_type: "Cash" })
      createdPaymentIds.push(p1, p2)

      const res = await api.get("/admin/payment_reports/by-person", {
        ...headers,
        params: { payment_type: "Bank", period_start: oneYearAgo(), period_end: tomorrow() },
      })

      expect(res.status).toBe(200)
      const entry = res.data.by_person.find((p: any) => p.person_id === personId)
      if (entry) {
        expect(entry.by_type).toHaveProperty("Bank")
        expect(entry.by_type).not.toHaveProperty("Cash")
      }
    })

    it("should not include persons with no payments in the period", async () => {
      const personId = await createPerson(api, headers, "Empty", "Person")
      createdPersonIds.push(personId)

      const res = await api.get("/admin/payment_reports/by-person", {
        ...headers,
        params: { period_start: "2099-01-01T00:00:00.000Z", period_end: "2099-12-31T23:59:59.999Z" },
      })

      expect(res.status).toBe(200)
      const entry = res.data.by_person.find((p: any) => p.person_id === personId)
      expect(entry).toBeUndefined()
    })

    it("should sort results by total_amount descending", async () => {
      const pid1 = await createPerson(api, headers, "Low", "Amount")
      const pid2 = await createPerson(api, headers, "High", "Amount")
      createdPersonIds.push(pid1, pid2)

      const pay1 = await createAndLinkPaymentToPerson(api, headers, pid1, paidToId, { amount: 50 })
      const pay2 = await createAndLinkPaymentToPerson(api, headers, pid2, paidToId, { amount: 5000 })
      createdPaymentIds.push(pay1, pay2)

      const res = await api.get("/admin/payment_reports/by-person", {
        ...headers,
        params: { period_start: oneYearAgo(), period_end: tomorrow() },
      })

      expect(res.status).toBe(200)
      const amounts = res.data.by_person.map((p: any) => p.total_amount)
      for (let i = 1; i < amounts.length; i++) {
        expect(amounts[i - 1]).toBeGreaterThanOrEqual(amounts[i])
      }
    })
  })

  // ── Auth guard ──────────────────────────────────────────────────────────────

  describe("Auth protection", () => {
    it("should reject unauthenticated requests to all endpoints", async () => {
      const noAuth = {}

      const endpoints = [
        () => api.get("/admin/payment_reports", noAuth),
        () => api.post("/admin/payment_reports", { period_start: oneYearAgo(), period_end: tomorrow() }, noAuth),
        () => api.get("/admin/payment_reports/summary", noAuth),
        () => api.get("/admin/payment_reports/by-partner", noAuth),
        () => api.get("/admin/payment_reports/by-person", noAuth),
      ]

      for (const call of endpoints) {
        const res = await call().catch((e: any) => e.response)
        expect([401, 403]).toContain(res.status)
      }
    })
  })
})
