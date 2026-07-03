import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import { PARTNER_ONBOARDING_PROFILE_MODULE } from "../../../src/modules/partner-onboarding-profile"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(120 * 1000)

// NOTE (local runs): the repo `.env` sets PARTNER_EMAIL_VERIFICATION=true, which
// makes partner login return a verification-required token → `/partners` 401.
// Run these locally with PARTNER_EMAIL_VERIFICATION=false (CI leaves it unset).

// #859 S2 (#861) — end-to-end artisan proposal → admin approve/reject state
// machine + the widget's read endpoint.
//
//   • A `core_channel_listing` (artisan) partner creates a product → it enters
//     as native status `proposed`, bound to their own channel, with a
//     partner-product ownership link.
//   • GET /admin/partners/products/:id/proposal drives the admin widget:
//     is_artisan + status + can_approve/can_reject (from the SAME pure
//     decideApprovalTransition the POST routes use).
//   • approve → published (+ emits partner_product.approved for cross-list).
//     reject → rejected. approve is allowed again from rejected (re-approve).
//   • Ordinary (non-artisan) products are invisible to the widget and can't be
//     actioned (the POST routes 404 with not_artisan_owned).

async function createArtisanPartner(
  api: any,
  adminHeaders: Record<string, any>,
  container: any,
  opts: { artisan?: boolean } = {}
) {
  const artisan = opts.artisan ?? true
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `artisan-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let login = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = {
    Authorization: `Bearer ${login.data.token}`,
  }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `Artisan ${unique}`,
      handle: `artisan-${unique}`,
      admin: { email, first_name: "Arti", last_name: "San" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  // Re-login so the token carries the partner association.
  login = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login.data.token}` }

  const currenciesRes = await api.get("/admin/currencies", adminHeaders)
  const currencies = currenciesRes.data.currencies || []
  const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
  const currencyCode = String((usd || currencies[0]).code).toLowerCase()

  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `Store ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `Channel ${unique}`, description: "Default" },
      region: { name: "Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Warehouse",
        address: {
          address_1: "1 Test St",
          city: "Anywhere",
          postal_code: "00000",
          country_code: "US",
        },
      },
    },
    { headers }
  )

  // Mark the partner as an artisan (core_channel_listing) by seeding the
  // onboarding profile directly — that's what the products route reads.
  if (artisan) {
    const onboarding: any = container.resolve(PARTNER_ONBOARDING_PROFILE_MODULE)
    await onboarding.createPartnerOnboardingProfiles({
      partner_id: partnerId,
      selling_mode: "core_channel_listing",
    })
  }

  return {
    headers,
    partnerId,
    storeId: storeRes.data.store.id,
    currencyCode,
  }
}

async function createProduct(
  api: any,
  headers: Record<string, any>,
  storeId: string
) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const res = await api.post(
    "/partners/products",
    {
      store_id: storeId,
      product: {
        title: `Artisan Product ${unique}`,
        options: [
          { title: "Default option", values: ["Default option value"] },
        ],
      },
    },
    { headers }
  )
  return res
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Artisan product approval — propose → approve/reject state machine", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("creates an artisan product as 'proposed' with a proposal message", async () => {
      const container = getContainer()
      const partner = await createArtisanPartner(api, adminHeaders, container)

      const res = await createProduct(api, partner.headers, partner.storeId)
      expect(res.status).toBe(201)
      expect(res.data.message).toBe("Product proposed")
      expect(res.data.product.status).toBe("proposed")
    })

    it("exposes proposal state to the admin widget and approves → published", async () => {
      const container = getContainer()
      const partner = await createArtisanPartner(api, adminHeaders, container)
      const created = await createProduct(api, partner.headers, partner.storeId)
      const productId = created.data.product.id

      // Widget read endpoint reflects a fresh proposal.
      const proposal = await api.get(
        `/admin/partners/products/${productId}/proposal`,
        adminHeaders
      )
      expect(proposal.status).toBe(200)
      expect(proposal.data).toMatchObject({
        is_artisan: true,
        status: "proposed",
        partner_id: partner.partnerId,
        can_approve: true,
        can_reject: true,
      })

      // Approve → published + approval event.
      const approve = await api.post(
        `/admin/partners/products/${productId}/approve`,
        {},
        adminHeaders
      )
      expect(approve.status).toBe(200)
      expect(approve.data).toMatchObject({
        id: productId,
        status: "published",
        partner_id: partner.partnerId,
        event: "partner_product.approved",
      })

      // A published product is no longer actionable.
      const after = await api.get(
        `/admin/partners/products/${productId}/proposal`,
        adminHeaders
      )
      expect(after.data).toMatchObject({
        is_artisan: true,
        status: "published",
        can_approve: false,
        can_reject: false,
      })
    })

    it("rejects → rejected, then allows re-approval → published", async () => {
      const container = getContainer()
      const partner = await createArtisanPartner(api, adminHeaders, container)
      const created = await createProduct(api, partner.headers, partner.storeId)
      const productId = created.data.product.id

      const reject = await api.post(
        `/admin/partners/products/${productId}/reject`,
        {},
        adminHeaders
      )
      expect(reject.status).toBe(200)
      expect(reject.data).toMatchObject({
        id: productId,
        status: "rejected",
        event: "partner_product.rejected",
      })

      // Rejected → re-approvable but not re-rejectable.
      const proposal = await api.get(
        `/admin/partners/products/${productId}/proposal`,
        adminHeaders
      )
      expect(proposal.data).toMatchObject({
        status: "rejected",
        can_approve: true,
        can_reject: false,
      })

      const approve = await api.post(
        `/admin/partners/products/${productId}/approve`,
        {},
        adminHeaders
      )
      expect(approve.status).toBe(200)
      expect(approve.data.status).toBe("published")
    })

    it("carries the rejection reason on the reject response + event payload", async () => {
      const container = getContainer()
      const partner = await createArtisanPartner(api, adminHeaders, container)
      const created = await createProduct(api, partner.headers, partner.storeId)
      const productId = created.data.product.id

      const reject = await api.post(
        `/admin/partners/products/${productId}/reject`,
        { rejection_reason: "Please add clearer photos." },
        adminHeaders
      )
      expect(reject.status).toBe(200)
      expect(reject.data.status).toBe("rejected")
      expect(reject.data.rejection_reason).toBe("Please add clearer photos.")
    })

    it("lets the owning partner re-submit a rejected product → proposed", async () => {
      const container = getContainer()
      const partner = await createArtisanPartner(api, adminHeaders, container)
      const created = await createProduct(api, partner.headers, partner.storeId)
      const productId = created.data.product.id

      await api.post(`/admin/partners/products/${productId}/reject`, {}, adminHeaders)

      // Partner re-submits.
      const resubmit = await api.post(
        `/partners/products/${productId}/resubmit`,
        {},
        { headers: partner.headers }
      )
      expect(resubmit.status).toBe(200)
      expect(resubmit.data).toMatchObject({ id: productId, status: "proposed" })

      // Back in the review queue: re-approvable and re-rejectable.
      const proposal = await api.get(
        `/admin/partners/products/${productId}/proposal`,
        adminHeaders
      )
      expect(proposal.data).toMatchObject({
        status: "proposed",
        can_approve: true,
        can_reject: true,
      })
    })

    it("refuses re-submission of a product that isn't rejected", async () => {
      const container = getContainer()
      const partner = await createArtisanPartner(api, adminHeaders, container)
      const created = await createProduct(api, partner.headers, partner.storeId)
      const productId = created.data.product.id

      // Still 'proposed' — not re-submittable.
      const resubmit = await api
        .post(
          `/partners/products/${productId}/resubmit`,
          {},
          { headers: partner.headers }
        )
        .catch((e: any) => e.response)
      expect(resubmit.status).toBe(400)
    })

    it("does not let a different partner re-submit someone else's product", async () => {
      const container = getContainer()
      const owner = await createArtisanPartner(api, adminHeaders, container)
      const created = await createProduct(api, owner.headers, owner.storeId)
      const productId = created.data.product.id
      await api.post(`/admin/partners/products/${productId}/reject`, {}, adminHeaders)

      const stranger = await createArtisanPartner(api, adminHeaders, container)
      const resubmit = await api
        .post(
          `/partners/products/${productId}/resubmit`,
          {},
          { headers: stranger.headers }
        )
        .catch((e: any) => e.response)
      expect(resubmit.status).toBe(404)
    })

    it("cannot reject an already-published artisan product", async () => {
      const container = getContainer()
      const partner = await createArtisanPartner(api, adminHeaders, container)
      const created = await createProduct(api, partner.headers, partner.storeId)
      const productId = created.data.product.id

      await api.post(`/admin/partners/products/${productId}/approve`, {}, adminHeaders)

      const reject = await api
        .post(`/admin/partners/products/${productId}/reject`, {}, adminHeaders)
        .catch((e: any) => e.response)
      expect(reject.status).toBe(400)
    })

    it("treats a non-artisan partner's product as not-artisan (widget hidden, actions 404)", async () => {
      const container = getContainer()
      const partner = await createArtisanPartner(api, adminHeaders, container, {
        artisan: false,
      })
      const created = await createProduct(api, partner.headers, partner.storeId)
      const productId = created.data.product.id

      // A non-artisan partner publishes directly — no proposal, no owner link.
      expect(created.data.message).toBe("Product created")

      const proposal = await api.get(
        `/admin/partners/products/${productId}/proposal`,
        adminHeaders
      )
      expect(proposal.data).toMatchObject({
        is_artisan: false,
        can_approve: false,
        can_reject: false,
      })

      const approve = await api
        .post(`/admin/partners/products/${productId}/approve`, {}, adminHeaders)
        .catch((e: any) => e.response)
      expect(approve.status).toBe(404)
    })
  })
})
