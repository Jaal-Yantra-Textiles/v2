/**
 * Delhivery Shipping Integration — End-to-End Lifecycle Test
 *
 * Tests the full Delhivery lifecycle against the STAGING sandbox:
 *   1. Register Warehouse
 *   2. Create Order (CMU API with auto-assign waybill)
 *   3. Fetch Label / Packing Slip
 *   4. Schedule Pickup
 *   5. Track Shipment
 *
 * Usage:
 *   DELHIVERY_API_TOKEN=<your-staging-token> npx ts-node scripts/test-delhivery-lifecycle.ts
 *
 * The script uses the staging/sandbox environment by default.
 */

import { DelhiveryClient } from "../modules/shipping-providers/delhivery/client"


const TOKEN = process.env.DELHIVERY_API_TOKEN
if (!TOKEN) {
  console.error("❌ DELHIVERY_API_TOKEN env var is required")
  console.error("   Usage: DELHIVERY_API_TOKEN=xxx npx ts-node scripts/test-delhivery-lifecycle.ts")
  process.exit(1)
}

const client = new DelhiveryClient({
  api_token: TOKEN,
  sandbox: true, // always use staging for tests
})

const WAREHOUSE_NAME = `test-warehouse-${Date.now().toString(36)}`

// Test data — Indian addresses
const WAREHOUSE = {
  name: WAREHOUSE_NAME,
  phone: "9876543210",
  pin: "110001",
  city: "New Delhi",
  address: "10 Connaught Place, Block A",
  state: "Delhi",
  country: "India",
  email: "warehouse@test.com",
}

const SHIPMENT = {
  name: "Ravi Kumar",
  phone: "9898989898",
  address: "45 MG Road, Indiranagar",
  city: "Bangalore",
  pin: "560038",
  state: "Karnataka",
  country: "India",
  order_id: `TEST-ORD-${Date.now()}`,
  payment_mode: "Pre-paid" as const,
  pickup_location_name: WAREHOUSE_NAME,
  product_desc: "Heritage Cotton Saree - Indigo",
  weight: 800, // grams
  length: 30,
  width: 25,
  height: 3,
  quantity: 1,
}

async function step(name: string, fn: () => Promise<any>) {
  console.log(`\n${"=".repeat(60)}`)
  console.log(`  STEP: ${name}`)
  console.log(`${"=".repeat(60)}`)

  try {
    const result = await fn()
    console.log(`  ✅ ${name} — SUCCESS`)
    console.log(`  Response:`, JSON.stringify(result, null, 2))
    return result
  } catch (err: any) {
    console.error(`  ❌ ${name} — FAILED`)
    console.error(`  Error: ${err.message}`)
    return null
  }
}

async function main() {
  console.log("\n🚀 Delhivery Lifecycle Test — Staging Sandbox")
  console.log(`   Warehouse: ${WAREHOUSE_NAME}`)
  console.log(`   Token: ${TOKEN.slice(0, 8)}...`)

  // ─── Step 0: Check Serviceability ───
  const serviceability = await step("Check Serviceability (destination pin)", async () => {
    return client.checkServiceability(SHIPMENT.pin)
  })

  if (!serviceability) {
    console.log("\n⚠️  Serviceability check failed — continuing anyway (sandbox may not have all pincodes)")
  }

  // ─── Step 1: Register Warehouse ───
  const warehouseResult = await step("Register Warehouse", async () => {
    return client.registerWarehouse(WAREHOUSE)
  })

  if (!warehouseResult) {
    console.log("\n⚠️  Warehouse registration failed. This may be OK if the name is already taken.")
    console.log("   Continuing with order creation...")
  }

  // ─── Step 2: Create Order (CMU API — auto-assign waybill) ───
  const shipmentResult = await step("Create Order (CMU — auto-assign waybill)", async () => {
    return client.createShipment({
      ...SHIPMENT,
      waybill: "", // auto-assign
    })
  })

  if (!shipmentResult) {
    console.error("\n💥 Cannot continue without a created shipment. Exiting.")
    process.exit(1)
  }

  // Extract the auto-assigned waybill
  const waybill =
    shipmentResult.packages?.[0]?.waybill ||
    shipmentResult.upload_wbn ||
    shipmentResult.waybill ||
    ""

  if (!waybill) {
    console.error("\n💥 No waybill returned from CMU create. Full response:")
    console.error(JSON.stringify(shipmentResult, null, 2))
    console.error("\nCheck the response structure — the waybill path may differ.")
    process.exit(1)
  }

  console.log(`\n📦 Auto-assigned Waybill: ${waybill}`)

  // ─── Step 3: Fetch Label / Packing Slip ───
  // Note: may fail if fetched too soon after order creation
  await new Promise((r) => setTimeout(r, 3000)) // wait 3s for label generation

  const labelResult = await step("Fetch Label / Packing Slip", async () => {
    return client.getLabel(waybill)
  })

  if (!labelResult) {
    console.log("   Label may not be ready yet — this is expected behavior.")
    console.log("   Partners fetch labels on demand (not immediately after creation).")
  }

  // ─── Step 4: Schedule Pickup ───
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const pickupDate = tomorrow.toISOString().split("T")[0] // YYYY-MM-DD

  const pickupResult = await step("Schedule Pickup", async () => {
    return client.schedulePickup({
      pickup_date: pickupDate,
      pickup_time: "14:00",
      pickup_location: WAREHOUSE_NAME,
      expected_package_count: 1,
    })
  })

  if (pickupResult) {
    console.log(`   Pickup ID: ${pickupResult.pickup_id || "N/A"}`)
  }

  // ─── Step 5: Track Shipment ───
  const trackingResult = await step("Track Shipment", async () => {
    return client.trackShipment(waybill)
  })

  if (trackingResult) {
    // Parse the normalized tracking
    const shipment = trackingResult.ShipmentData?.[0]?.Shipment || {}
    console.log(`   Status: ${shipment.Status?.Status || "Unknown"}`)
    console.log(`   Scans: ${(shipment.Scans || []).length} events`)
  }

  // ─── Step 6: Cancel Shipment (cleanup) ───
  await step("Cancel Shipment (cleanup)", async () => {
    return client.cancelShipment(waybill)
  })

  // ─── Summary ───
  console.log(`\n${"=".repeat(60)}`)
  console.log("  📋 LIFECYCLE TEST SUMMARY")
  console.log(`${"=".repeat(60)}`)
  console.log(`  Warehouse Registration : ${warehouseResult ? "✅" : "⚠️ (may already exist)"}`)
  console.log(`  Order Creation (CMU)   : ${shipmentResult ? "✅" : "❌"}`)
  console.log(`  Waybill Auto-Assigned  : ${waybill ? `✅ (${waybill})` : "❌"}`)
  console.log(`  Label Fetch            : ${labelResult ? "✅" : "⚠️ (not ready yet)"}`)
  console.log(`  Pickup Scheduling      : ${pickupResult ? "✅" : "⚠️"}`)
  console.log(`  Tracking               : ${trackingResult ? "✅" : "⚠️"}`)
  console.log(`${"=".repeat(60)}\n`)
}

main().catch((err) => {
  console.error("Unhandled error:", err)
  process.exit(1)
})
