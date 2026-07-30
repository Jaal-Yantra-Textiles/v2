import { Modules } from "@medusajs/utils"
import Scrypt from "scrypt-kdf"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120 * 1000)

setupSharedTestSuite(() => {
  let investorHeaders: Record<string, string>
  let investorId: string
  const { api, getContainer } = getSharedTestEnv()

  const TEST_EMAIL = `investor-${Date.now()}@medusa-test.com`
  const TEST_PASSWORD = "supersecret"

  // Investor onboarding is invite-only. `POST /investors` is deliberately
  // disabled and answers 400 ("Investor self-registration is disabled"), so
  // provisioning goes through `POST /admin/investors` as a platform admin.
  //
  // That route issues a random temp password and surfaces it ONLY via the
  // `investor.created.fromAdmin` event (for the onboarding email) — never in
  // the response. So to log in as the investor afterwards we set a known
  // password directly on the emailpass provider identity the workflow created.
  const setInvestorPassword = async (email: string, password: string) => {
    const authModule: any = getContainer().resolve(Modules.AUTH)
    const identities = await authModule.listProviderIdentities({
      entity_id: email,
    })
    const emailpass = (identities || []).find(
      (pi: any) => pi.provider === "emailpass"
    )
    if (!emailpass) {
      throw new Error(`no emailpass identity was provisioned for ${email}`)
    }
    const hashed = (
      await Scrypt.kdf(Buffer.from(password), { logN: 15, r: 8, p: 1 })
    ).toString("base64")
    await authModule.updateProviderIdentities({
      id: emailpass.id,
      provider_metadata: {
        ...(emailpass.provider_metadata || {}),
        password: hashed,
      },
    })
  }

  /**
   * Provision an investor the only way the platform allows: as a platform admin.
   * Returns the raw response so callers can assert failures (e.g. duplicate
   * handle) as well as successes.
   */
  const provisionInvestor = async (body: Record<string, any>) => {
    await createAdminUser(getContainer())
    const adminHeaders = await getAuthHeaders(api)
    const res = await api
      .post("/admin/investors", body, adminHeaders)
      .catch((e: any) => e.response)

    if (res?.status === 201) {
      await setInvestorPassword(body.admin.email, TEST_PASSWORD)
    }
    return res
  }

  const loginInvestor = async (email = TEST_EMAIL) => {
    const res = await api.post("/auth/investor/emailpass", {
      email,
      password: TEST_PASSWORD,
    })
    return { Authorization: `Bearer ${res.data.token}` }
  }

  describe("Investor Registration & Auth", () => {
    test("should provision an investor successfully (invite-only)", async () => {
      const res = await provisionInvestor({
        name: "Investor One",
        email: TEST_EMAIL,
        admin: {
          email: TEST_EMAIL,
          first_name: "Investor",
          last_name: "One",
        },
      })

      expect(res.status).toBe(201)
      expect(res.data.investor).toBeDefined()
      expect(res.data.investor.name).toBe("Investor One")
      // The admin route returns the admin alongside the investor rather than
      // nested under `investor.admins`.
      expect(res.data.investor_admin).toBeDefined()
      expect(res.data.investor_admin.email).toBe(TEST_EMAIL)
    })

    test("should reject investor self-registration", async () => {
      // Unauthenticated callers never reach the handler — investor auth runs
      // first and answers 401. Provision + log in so the request gets past auth
      // and actually exercises the self-registration guard itself.
      await provisionInvestor({
        name: "Existing Investor",
        email: TEST_EMAIL,
        admin: { email: TEST_EMAIL },
      })
      investorHeaders = await loginInvestor()

      const res = await api
        .post(
          "/investors",
          {
            name: "Self Signup",
            email: TEST_EMAIL,
            admin: { email: TEST_EMAIL },
          },
          { headers: investorHeaders }
        )
        .catch((e) => e.response)

      expect(res.status).toBe(400)
      expect(res.data.message).toContain(
        "Investor self-registration is disabled"
      )
    })

    test("should reject unauthenticated GET /investors/me", async () => {
      const res = await api.get("/investors/me").catch((e) => e.response)
      expect(res.status).toBe(401)
    })

    test("should GET /investors/me after provisioning + login", async () => {
      await provisionInvestor({
        name: "Profile Investor",
        email: TEST_EMAIL,
        admin: { email: TEST_EMAIL, first_name: "Profile", last_name: "Inv" },
      })

      investorHeaders = await loginInvestor()

      const res = await api.get("/investors/me", { headers: investorHeaders })
      expect(res.status).toBe(200)
      expect(res.data.investor).toBeDefined()
      expect(res.data.investor.name).toBe("Profile Investor")
    })

    test("should reject duplicate handle", async () => {
      const first = await provisionInvestor({
        name: "Dup A",
        handle: "dup-handle",
        email: TEST_EMAIL,
        admin: { email: TEST_EMAIL },
      })
      expect(first.status).toBe(201)

      const otherEmail = `other-${Date.now()}@test.com`
      const dup = await provisionInvestor({
        name: "Dup B",
        handle: "dup-handle",
        email: otherEmail,
        admin: { email: otherEmail },
      })
      expect(dup.status).toBe(400)
    })
  })

  describe("Cap Table Management", () => {
    let capTableId: string

    beforeEach(async () => {
      const createRes = await provisionInvestor({
        name: "Cap Table Owner",
        email: TEST_EMAIL,
        admin: { email: TEST_EMAIL, first_name: "Cap", last_name: "Owner" },
      })
      investorId = createRes.data.investor.id

      investorHeaders = await loginInvestor()

      const capRes = await api.post(
        "/investors/cap-tables",
        {
          company_id: "company-test-1",
          name: "Seed Cap Table",
          currency_code: "INR",
        },
        { headers: investorHeaders }
      )
      capTableId = capRes.data.cap_table.id
    })

    test("should create a cap table", async () => {
      expect(capTableId).toBeDefined()
    })

    test("should get cap table by id", async () => {
      const res = await api.get(`/investors/cap-tables/${capTableId}`, {
        headers: investorHeaders,
      })
      expect(res.status).toBe(200)
      expect(res.data.cap_table.id).toBe(capTableId)
    })

    test("should update cap table", async () => {
      const res = await api.post(
        `/investors/cap-tables/${capTableId}`,
        {
          pre_money_valuation: 50000000,
          post_money_valuation: 75000000,
          status: "active",
        },
        { headers: investorHeaders }
      )
      expect(res.status).toBe(200)
      expect(res.data.cap_table.status).toBe("active")
    })

    test("should add a share class", async () => {
      const res = await api.post(
        `/investors/cap-tables/${capTableId}/share-classes`,
        {
          name: "Common Stock",
          class_type: "common",
          authorized_shares: 1000000,
        },
        { headers: investorHeaders }
      )
      expect(res.status).toBe(200)
      expect(res.data.share_class.name).toBe("Common Stock")
    })

    test("should add a funding round", async () => {
      const res = await api.post(
        `/investors/cap-tables/${capTableId}/funding-rounds`,
        {
          name: "Seed Round",
          round_type: "seed",
          target_amount: 25000000,
        },
        { headers: investorHeaders }
      )
      expect(res.status).toBe(200)
      expect(res.data.funding_round.name).toBe("Seed Round")
    })

    test("should add a stake", async () => {
      const scRes = await api.post(
        `/investors/cap-tables/${capTableId}/share-classes`,
        { name: "Preferred A", class_type: "preferred" },
        { headers: investorHeaders }
      )

      const res = await api.post(
        `/investors/cap-tables/${capTableId}/stakes`,
        {
          investor_id: investorId,
          share_class_id: scRes.data.share_class.id,
          number_of_shares: 100000,
          share_price: 50,
          total_invested: 5000000,
          status: "fully_paid",
        },
        { headers: investorHeaders }
      )
      expect(res.status).toBe(200)
      expect(res.data.stake.number_of_shares).toBe(100000)
    })

    test("should create a call for shares", async () => {
      const res = await api.post(
        `/investors/cap-tables/${capTableId}/calls-for-shares`,
        {
          name: "Rights Issue Q1",
          call_type: "rights_issue",
          target_amount: 30000000,
          ratio: "1:10",
        },
        { headers: investorHeaders }
      )
      expect(res.status).toBe(200)
      expect(res.data.call_for_shares.call_type).toBe("rights_issue")
    })

    test("should add a document", async () => {
      const res = await api.post(
        `/investors/cap-tables/${capTableId}/documents`,
        {
          company_id: "company-test-1",
          title: "Term Sheet",
          document_type: "term_sheet",
          file_key: "docs/term-sheet.pdf",
          file_name: "term-sheet.pdf",
        },
        { headers: investorHeaders }
      )
      expect(res.status).toBe(200)
      expect(res.data.document.title).toBe("Term Sheet")
    })
  })

  describe("Payment Tracking", () => {
    let stakeId: string

    beforeEach(async () => {
      const createRes = await provisionInvestor({
        name: "Pay Investor",
        email: TEST_EMAIL,
        admin: { email: TEST_EMAIL, first_name: "Pay", last_name: "Inv" },
      })
      investorId = createRes.data.investor.id

      investorHeaders = await loginInvestor()

      const capRes = await api.post(
        "/investors/cap-tables",
        { company_id: "pay-co", name: "Pay Cap Table" },
        { headers: investorHeaders }
      )

      const stakeRes = await api.post(
        `/investors/cap-tables/${capRes.data.cap_table.id}/stakes`,
        {
          investor_id: investorId,
          number_of_shares: 50000,
          share_price: 100,
          total_invested: 5000000,
          status: "partially_paid",
        },
        { headers: investorHeaders }
      )
      stakeId = stakeRes.data.stake.id
    })

    test("should create a payment for a stake", async () => {
      const res = await api.post(
        `/investors/stakes/${stakeId}/payments`,
        {
          investor_id: investorId,
          company_id: "pay-co",
          amount: 2500000,
          currency_code: "INR",
          payment_type: "subscription",
          status: "completed",
          method: "bank_transfer",
          reference_number: "TXN12345",
        },
        { headers: investorHeaders }
      )
      expect(res.status).toBe(200)
      expect(res.data.payment.amount).toBe(2500000)
      expect(res.data.payment.status).toBe("completed")
    })

    test("should list payments for a stake", async () => {
      await api.post(
        `/investors/stakes/${stakeId}/payments`,
        {
          investor_id: investorId,
          company_id: "pay-co",
          amount: 1000000,
          payment_type: "capital_call",
          status: "pending",
        },
        { headers: investorHeaders }
      )

      const res = await api.get(`/investors/stakes/${stakeId}/payments`, {
        headers: investorHeaders,
      })
      expect(res.status).toBe(200)
      expect(Array.isArray(res.data.payments)).toBe(true)
      expect(res.data.payments.length).toBe(1)
    })
  })

  describe("Pipeline Tracking", () => {
    beforeEach(async () => {
      const createRes = await provisionInvestor({
        name: "Pipeline Investor",
        email: TEST_EMAIL,
        admin: { email: TEST_EMAIL, first_name: "Pipe", last_name: "Inv" },
      })
      investorId = createRes.data.investor.id

      investorHeaders = await loginInvestor()
    })

    test("should create a pipeline entry", async () => {
      const res = await api.post(
        "/investors/pipeline",
        {
          company_id: "pipeline-co",
          stage: "due_diligence",
          target_amount: 10000000,
        },
        { headers: investorHeaders }
      )
      expect(res.status).toBe(200)
      expect(res.data.pipeline.stage).toBe("due_diligence")
    })

    test("should list pipeline entries", async () => {
      await api.post(
        "/investors/pipeline",
        { company_id: "pipeline-co-2", stage: "lead" },
        { headers: investorHeaders }
      )

      const res = await api.get("/investors/pipeline", {
        headers: investorHeaders,
      })
      expect(res.status).toBe(200)
      expect(Array.isArray(res.data.pipeline)).toBe(true)
      expect(res.data.count).toBeGreaterThanOrEqual(1)
    })
  })
})
