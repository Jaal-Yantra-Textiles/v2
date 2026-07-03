import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import visualFlowEventTriggerHandler from "../../../src/subscribers/visual-flow-event-trigger"
import { VISUAL_FLOWS_MODULE } from "../../../src/modules/visual_flows"
import { PARTNER_ONBOARDING_PROFILE_MODULE } from "../../../src/modules/partner-onboarding-profile"
import { FLOW_DEF } from "../../../src/scripts/seed-artisan-product-approval-flow"
import seedPartnerEmailTemplates from "../../../src/scripts/seed-partner-email-templates"

jest.setTimeout(120 * 1000)

// #859 S2 (#861) — the ENTIRE artisan review email path, end to end at runtime:
//   seed templates → activate the flow → artisan creates a product → admin
//   rejects it with a reason → the partner_product.rejected event drives the
//   visual flow → it reads product + partner, resolves the artisan's admin
//   email, and sends the rejection email (down the SEND branch, not skip).
//
// We assert on the persisted execution data_chain: the flow resolved the real
// artisan email + the artisan-product-rejected template (proving read →
// resolve → condition(success) → send all ran on live data). send_email itself
// never throws (it catches provider errors), so a mailer-less test env can't
// mask a real branch/resolution bug.
//
// NOTE: partner login is gated by PARTNER_EMAIL_VERIFICATION — run with it off.
// ONE test on purpose (integration runner TRUNCATEs between tests → deadlock).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForCompletion(service: any, flowId: string) {
  for (let i = 0; i < 80; i++) {
    const execs: any[] = await service.listFlowExecutions(flowId)
    const done = execs.find(
      (e) => e.status === "completed" || e.status === "failed"
    )
    if (done) return done
    await sleep(250)
  }
  return null
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  it("rejecting an artisan product drives the flow to email the artisan the reason", async () => {
    const container = getContainer()
    const service: any = container.resolve(VISUAL_FLOWS_MODULE)

    // ── Admin auth ────────────────────────────────────────────────────────
    await createAdminUser(container)
    const adminHeaders = await getAuthHeaders(api)

    // ── Seed the outcome email templates ─────────────────────────────────
    await seedPartnerEmailTemplates({ container })

    // ── Activate the review-email flow (FLOW_DEF ships as draft) ──────────
    const flow = await service.createCompleteFlow({
      flow: {
        name: FLOW_DEF.name,
        description: FLOW_DEF.description,
        status: "active",
        trigger_type: FLOW_DEF.trigger_type,
        trigger_config: FLOW_DEF.trigger_config,
        canvas_state: FLOW_DEF.canvas_state,
      },
      operations: FLOW_DEF.operations,
      connections: FLOW_DEF.connections,
    })

    // ── Create an artisan partner (+ admin email) + store + product ───────
    const unique = Date.now() + Math.random().toString(36).slice(2, 6)
    const email = `artisan-e2e-${unique}@medusa-test.com`
    const password = "supersecret"

    await api.post("/auth/partner/emailpass/register", { email, password })
    let login = await api.post("/auth/partner/emailpass", { email, password })
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

    login = await api.post("/auth/partner/emailpass", { email, password })
    headers = { Authorization: `Bearer ${login.data.token}` }

    const currenciesRes = await api.get("/admin/currencies", adminHeaders)
    const currencyCode = String(
      (currenciesRes.data.currencies || [])[0].code
    ).toLowerCase()

    const storeRes = await api.post(
      "/partners/stores",
      {
        store: {
          name: `Store ${unique}`,
          supported_currencies: [
            { currency_code: currencyCode, is_default: true },
          ],
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

    const onboarding: any = container.resolve(PARTNER_ONBOARDING_PROFILE_MODULE)
    await onboarding.createPartnerOnboardingProfiles({
      partner_id: partnerId,
      selling_mode: "core_channel_listing",
    })

    const created = await api.post(
      "/partners/products",
      {
        store_id: storeRes.data.store.id,
        product: {
          title: `Handloom Scarf ${unique}`,
          options: [{ title: "Default option", values: ["Default option value"] }],
        },
      },
      { headers }
    )
    const productId = created.data.product.id
    expect(created.data.product.status).toBe("proposed")

    // ── Admin rejects with a reason (real transition + event) ─────────────
    const reason = "Please add clearer photos and a fabric composition."
    const reject = await api.post(
      `/admin/partners/products/${productId}/reject`,
      { rejection_reason: reason },
      adminHeaders
    )
    expect(reject.data.status).toBe("rejected")

    // ── Drive the flow deterministically off the same event ───────────────
    await visualFlowEventTriggerHandler({
      event: {
        name: "partner_product.rejected",
        data: { id: productId, partner_id: partnerId, rejection_reason: reason },
      },
      container,
    } as any)

    // ── The flow ran end to end on live data ──────────────────────────────
    const done = await waitForCompletion(service, flow.id)
    expect(done).toBeTruthy()
    expect(done.status).toBe("completed")

    const chain = JSON.stringify(done.data_chain ?? done)
    // Resolve step built the rejection email to the real artisan admin — i.e.
    // it took the SEND branch, not the skip branch.
    expect(chain).toContain(email)
    expect(chain).toContain("artisan-product-rejected")
    expect(chain).toContain(reason)
    expect(chain).not.toContain("no_admin_email")
    expect(chain).not.toContain("partner_not_found")
  })
})
