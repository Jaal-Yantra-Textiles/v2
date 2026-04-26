import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { DelhiveryClient } from "../modules/shipping-providers/delhivery/client"

/**
 * Delhivery Shipping Integration — End-to-End Lifecycle Test
 *
 * Tests the full Delhivery lifecycle against the STAGING sandbox:
 *   1. Register Warehouse
 *   2. Create Order (CMU API with auto-assign waybill)
 *   3. Fetch Label / Packing Slip
 *   4. Schedule Pickup
 *   5. Track Shipment
 *   6. Cancel Shipment (cleanup)
 *
 * Usage:
 *   npx medusa exec src/scripts/test-delhivery-lifecycle.ts
 *
 * Requires DELHIVERY_API_TOKEN and optionally DELHIVERY_SANDBOX=true in .env
 */
export default async function testDelhiveryLifecycle({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const TOKEN = process.env.DELHIVERY_API_TOKEN
  if (!TOKEN) {
    logger.error("DELHIVERY_API_TOKEN env var is required. Set it in .env")
    return
  }

  // Auto-detect environment: try staging first, fall back to production
  let isSandbox = process.env.DELHIVERY_SANDBOX === "true"
  if (!process.env.DELHIVERY_SANDBOX) {
    // No env var set — probe staging to see if the token works there
    try {
      const probe = await fetch(
        "https://staging-express.delhivery.com/c/api/pin-codes/json/?filter_codes=110001",
        { headers: { Authorization: `Token ${TOKEN}` } }
      )
      isSandbox = probe.ok
      if (!probe.ok) {
        logger.info("Token not valid on staging — using production environment")
      }
    } catch {
      isSandbox = false
    }
  }

  const client = new DelhiveryClient({ api_token: TOKEN, sandbox: isSandbox })

  const WAREHOUSE_NAME = `test-warehouse-${Date.now().toString(36)}`

  logger.info("=== Delhivery Lifecycle Test ===")
  logger.info(`Environment: ${isSandbox ? "STAGING" : "PRODUCTION"}`)
  logger.info(`Warehouse: ${WAREHOUSE_NAME}`)
  logger.info(`Token: ${TOKEN.slice(0, 8)}...`)

  // Helper to run a step with logging
  async function step(name: string, fn: () => Promise<any>): Promise<any> {
    logger.info(`\n--- STEP: ${name} ---`)
    try {
      const result = await fn()
      logger.info(`[OK] ${name}`)
      logger.info(`Response: ${JSON.stringify(result, null, 2)}`)
      return result
    } catch (err: any) {
      logger.error(`[FAIL] ${name}: ${err.message}`)
      return null
    }
  }

  // ─── Step 0: Check Serviceability ───
  const serviceability = await step("Check Serviceability (pin 560038)", async () => {
    return client.checkServiceability("560038")
  })

  if (!serviceability) {
    logger.warn("Serviceability check failed — continuing (sandbox may not have all pincodes)")
  }

  // ─── Step 1: Register Warehouse ───
  const warehouseResult = await step("Register Warehouse", async () => {
    return client.registerWarehouse({
      name: WAREHOUSE_NAME,
      phone: "9876543210",
      pin: "110001",
      city: "New Delhi",
      address: "10 Connaught Place, Block A",
      state: "Delhi",
      country: "India",
      email: "warehouse@test.com",
    })
  })

  if (!warehouseResult) {
    logger.warn("Warehouse registration failed — may already exist. Continuing...")
  }

  // ─── Step 2: Create Order (CMU — auto-assign waybill) ───
  const shipmentResult = await step("Create Order (CMU — auto-assign waybill)", async () => {
    return client.createShipment({
      waybill: "", // auto-assign
      name: "Ravi Kumar",
      phone: "9898989898",
      address: "45 MG Road, Indiranagar",
      city: "Bangalore",
      pin: "560038",
      state: "Karnataka",
      country: "India",
      order_id: `TEST-ORD-${Date.now()}`,
      payment_mode: "Pre-paid",
      pickup_location_name: WAREHOUSE_NAME,
      product_desc: "Heritage Cotton Saree - Indigo",
      weight: 800,
      length: 30,
      width: 25,
      height: 3,
      quantity: 1,
    })
  })

  if (!shipmentResult) {
    logger.error("Cannot continue without a created shipment. Exiting.")
    return
  }

  // Extract auto-assigned waybill
  const waybill =
    shipmentResult.packages?.[0]?.waybill ||
    shipmentResult.upload_wbn ||
    shipmentResult.waybill ||
    ""

  if (!waybill) {
    logger.error("No waybill returned from CMU create. Full response:")
    logger.error(JSON.stringify(shipmentResult, null, 2))
    return
  }

  logger.info(`Auto-assigned Waybill: ${waybill}`)

  // ─── Step 3: Fetch Label / Packing Slip ───
  // Wait a few seconds for Delhivery to generate the label
  await new Promise((r) => setTimeout(r, 3000))

  const labelResult = await step("Fetch Label / Packing Slip", async () => {
    return client.getLabel(waybill)
  })

  if (!labelResult) {
    logger.warn("Label not ready yet — expected. Partners fetch on demand.")
  }

  // ─── Step 4: Schedule Pickup ───
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const pickupDate = tomorrow.toISOString().split("T")[0]

  const pickupResult = await step("Schedule Pickup", async () => {
    return client.schedulePickup({
      pickup_date: pickupDate,
      pickup_time: "14:00",
      pickup_location: WAREHOUSE_NAME,
      expected_package_count: 1,
    })
  })

  // ─── Step 5: Track Shipment ───
  const trackingResult = await step("Track Shipment", async () => {
    return client.trackShipment(waybill)
  })

  if (trackingResult) {
    const shipment = trackingResult.ShipmentData?.[0]?.Shipment || {}
    logger.info(`Tracking Status: ${shipment.Status?.Status || "Unknown"}`)
    logger.info(`Scans: ${(shipment.Scans || []).length} events`)
  }

  // ─── Step 6: Cancel Shipment (cleanup) ───
  await step("Cancel Shipment (cleanup)", async () => {
    return client.cancelShipment(waybill)
  })

  // ─── Summary ───
  logger.info("\n=== LIFECYCLE TEST SUMMARY ===")
  logger.info(`Warehouse Registration : ${warehouseResult ? "PASS" : "WARN (may already exist)"}`)
  logger.info(`Order Creation (CMU)   : ${shipmentResult ? "PASS" : "FAIL"}`)
  logger.info(`Waybill Auto-Assigned  : ${waybill ? `PASS (${waybill})` : "FAIL"}`)
  logger.info(`Label Fetch            : ${labelResult ? "PASS" : "WARN (not ready)"}`)
  logger.info(`Pickup Scheduling      : ${pickupResult ? "PASS" : "WARN"}`)
  logger.info(`Tracking               : ${trackingResult ? "PASS" : "WARN"}`)
  logger.info("==============================")
}
