import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(40000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let headers: any

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
  })

  it("creates a person, creates a payment method linked to the person, then creates a payment using that method and verifies listings", async () => {
    // 1) Create person
    const newPerson = {
      first_name: "Payee",
      last_name: "Tester",
      email: `payee.tester+${Date.now()}@example.com`,
      date_of_birth: "1990-01-01",
      metadata: { role: "supplier" },
    }
    const personRes = await api.post("/admin/persons", newPerson, headers)
    expect(personRes.status).toBe(201)
    const personId = personRes.data.person.id as string
    expect(personId).toBeTruthy()

    // 2) Create payment method for the person
    const pmBody = {
      type: "bank_account",
      account_name: "Payee Primary Account",
      account_number: "1234567890",
      bank_name: "Test Bank",
      ifsc_code: "TEST0001234",
      metadata: { preferred: true },
    }
    const pmRes = await api.post(`/admin/payments/persons/${personId}/methods`, pmBody, headers)
    expect(pmRes.status).toBe(201)
    const paymentMethodId = pmRes.data.paymentMethod.id as string
    expect(paymentMethodId).toBeTruthy()

    // 3) Confirm listing of person methods includes the new method
    const pmList = await api.get(`/admin/payments/persons/${personId}/methods?limit=10&offset=0`, headers)
    expect(pmList.status).toBe(200)
    expect(pmList.data.count).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(pmList.data.paymentMethods)).toBe(true)
    expect(pmList.data.paymentMethods.find((m: any) => m.id === paymentMethodId)).toBeTruthy()

    // 4) Create a payment using the created payment method (paid_to_id)
    const paymentBody = {
      amount: 1000,
      payment_type: "Bank",
      payment_date: new Date().toISOString(),
      metadata: { memo: "Initial payout" },
      paid_to_id: paymentMethodId,
    }

    // Use unified create+link API so the payment is linked to the person as well
    const linkRes = await api.post(`/admin/payments/link`, {
      payment: paymentBody,
      personIds: [personId],
    }, headers)
    expect(linkRes.status).toBe(201)
    const payment = linkRes.data.payment || linkRes.data?.result || linkRes.data
    // Shape depends on workflow wrapper; ensure we have an id
    const paymentId = (payment?.id) || (linkRes.data?.payment?.id)
    expect(paymentId).toBeTruthy()

    // 5) Verify payment is retrievable in person payments listing
    const listRes = await api.get(`/admin/payments/persons/${personId}`, headers)
    expect(listRes.status).toBe(200)
    expect(listRes.data.count).toBeGreaterThanOrEqual(1)
    const found = (listRes.data.payments || []).find((p: any) => p.id === paymentId)
    expect(found).toBeTruthy()
  })
})
