/**
 * Carrier facts on a run's goods transfers (#1553, closing part of #891).
 *
 *   GET /admin/production-runs/:id/transfers
 *
 * ## Why an integration test
 *
 * `attachCarrierToTransfers` is unit-tested. What it cannot show is that the
 * route reads the shipment at all: `goods_transfer.shipment_id` is a PLAIN
 * COLUMN, not a relation — deliberately, so adding transfers did not migrate
 * the live shipment table — which means nothing hydrates it for free. A
 * regression here looks exactly like the bug: the transfer still renders, just
 * without the waybill.
 *
 * ⚠️ The three carrier states are built directly through the module service
 * rather than by booking a carrier. There are no carrier credentials in CI, and
 * the point under test is the hydration, not the booking.
 */
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  let adminHeaders: any
  let runId: string

  const fulfilled = () => getContainer().resolve("fullfilled_orders") as any

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    adminHeaders = await getAuthHeaders(api)

    const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const design = await api.post(
      "/admin/designs",
      {
        name: `Transfer design ${unique}`,
        description: "Goods that move",
        design_type: "Original",
        status: "Commerce_Ready",
        priority: "Medium",
        estimated_cost: 500,
        cost_currency: "inr",
      },
      adminHeaders
    )

    const run = await api.post(
      "/admin/production-runs",
      { design_id: design.data.design.id, quantity: 9 },
      adminHeaders
    )
    expect(run.status).toBe(201)
    runId = run.data.production_run.id
  })

  async function createTransfer(overrides: Record<string, any> = {}) {
    const [transfer] = await fulfilled().createGoodsTransfers([
      {
        production_run_id: runId,
        quantity: 9,
        from_location_id: "sloc_from",
        to_location_id: "sloc_to",
        reason: "stock",
        status: "draft",
        ...overrides,
      },
    ])
    return transfer
  }

  async function createShipment(overrides: Record<string, any> = {}) {
    const [shipment] = await fulfilled().createInventoryShipments([
      {
        carrier: "delhivery",
        awb: "1234567890",
        tracking_number: "1234567890",
        tracking_url: "https://track.example/1234567890",
        label_url: "https://labels.example/1234567890.pdf",
        status: "picked_up",
        pickup_location_name: "Shramdaan",
        pickup_scheduled_date: "2026-08-29",
        provider_refs: { account: "SHOULD-NOT-LEAVE-THE-SERVER" },
        ...overrides,
      },
    ])
    return shipment
  }

  const transfers = async () => {
    const res = await api.get(
      `/admin/production-runs/${runId}/transfers`,
      adminHeaders
    )
    expect(res.status).toBe(200)
    return res.data.goods_transfers
  }

  // ─── the cases ────────────────────────────────────────────────────────────

  it("surfaces the AWB that used to exist only in a toast", async () => {
    const shipment = await createShipment()
    await createTransfer({ status: "in_transit", shipment_id: shipment.id })

    const [row] = await transfers()

    expect(row.carrier_state).toBe("booked")
    expect(row.shipment.awb).toBe("1234567890")
    expect(row.shipment.carrier).toBe("delhivery")
    expect(row.shipment.status).toBe("picked_up")
    expect(row.shipment.tracking_url).toBe("https://track.example/1234567890")
    expect(row.shipment.label_url).toBe("https://labels.example/1234567890.pdf")
    expect(row.shipment.pickup_scheduled_date).toBe("2026-08-29")
  })

  it("calls a van run between our own locations what it is", async () => {
    // 4 of the 6 transfers on prod. A real movement with no AWB, and
    // `not_booked` is the correct and FINAL answer for it.
    await createTransfer()

    const [row] = await transfers()

    expect(row.carrier_state).toBe("not_booked")
    expect(row.shipment).toBeNull()
  })

  it("🔴 does not report an unreadable shipment as an un-booked hop", async () => {
    // A waybill exists and we cannot see it. Saying "no carrier" here is how
    // someone re-books goods the carrier has already collected.
    await createTransfer({
      status: "in_transit",
      shipment_id: "ship_that_does_not_exist",
    })

    const [row] = await transfers()

    expect(row.carrier_state).toBe("unresolved")
    expect(row.shipment).toBeNull()
  })

  it("never ships the raw carrier payload to the client", async () => {
    // `provider_refs` and `metadata` carry account identifiers, and a transfer
    // list is also served to PARTNERS.
    const shipment = await createShipment()
    await createTransfer({ status: "in_transit", shipment_id: shipment.id })

    const [row] = await transfers()

    expect(row.shipment).not.toHaveProperty("provider_refs")
    expect(row.shipment).not.toHaveProperty("metadata")
    expect(JSON.stringify(row)).not.toContain("SHOULD-NOT-LEAVE-THE-SERVER")
  })

  it("resolves each transfer against its own shipment", async () => {
    const first = await createShipment()
    const second = await createShipment({ awb: "9999999999" })
    await createTransfer({ status: "in_transit", shipment_id: first.id })
    await createTransfer({ status: "in_transit", shipment_id: second.id })

    const rows = await transfers()

    expect(rows).toHaveLength(2)
    expect(rows.map((r: any) => r.shipment.awb).sort()).toEqual([
      "1234567890",
      "9999999999",
    ])
  })

  it("keeps every transfer field the route already returned", async () => {
    // The hydration must be additive — a screen reading `quantity` or `reason`
    // predates it.
    await createTransfer({ quantity: 4, reason: "finishing", notes: "handle with care" })

    const [row] = await transfers()

    expect(Number(row.quantity)).toBe(4)
    expect(row.reason).toBe("finishing")
    expect(row.notes).toBe("handle with care")
    expect(row.production_run_id).toBe(runId)
  })

  it("answers with an empty list for a run that has never moved", async () => {
    expect(await transfers()).toEqual([])
  })
})
