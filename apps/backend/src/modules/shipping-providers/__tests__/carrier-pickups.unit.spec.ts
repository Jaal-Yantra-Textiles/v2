import { carrierPickupMetadataKey } from "../carrier-pickups"
import { SHIPROCKET_PICKUP_METADATA_KEY } from "../pickup-locations"
import { DELHIVERY_WAREHOUSE_METADATA_KEY } from "../delhivery-warehouses"

/**
 * Which carrier's registry a pickup belongs to.
 *
 * `ensureCarrierPickup` falls through to Shiprocket for anything it does not
 * recognise, so an unlisted carrier does not fail — it registers a SHIPROCKET
 * nickname and hands it to a different carrier, which then refuses the manifest
 * with a warehouse-not-found error that points at the shipment rather than at
 * the registration. That is the defect this module was written for
 * (`create-production-run-transfer.ts`, order #83), and `starfleet` was the
 * third surface to hit it.
 */
describe("carrierPickupMetadataKey", () => {
  it("keeps each carrier on its own registry", () => {
    expect(carrierPickupMetadataKey("shiprocket")).toBe(
      SHIPROCKET_PICKUP_METADATA_KEY
    )
    expect(carrierPickupMetadataKey("delhivery")).toBe(
      DELHIVERY_WAREHOUSE_METADATA_KEY
    )
  })

  /**
   * 🔴 StarFleet (Delhivery International) has NO warehouse-create endpoint of
   * its own. A StarFleet pickup is registered through the domestic
   * `clientwarehouse/create` and referenced by that same name as
   * `pickup_warehouse_id` — so it must resolve to Delhivery's key, not its own
   * and certainly not Shiprocket's.
   */
  it("puts starfleet on Delhivery's registry, not Shiprocket's", () => {
    expect(carrierPickupMetadataKey("starfleet")).toBe(
      DELHIVERY_WAREHOUSE_METADATA_KEY
    )
    expect(carrierPickupMetadataKey("starfleet")).not.toBe(
      SHIPROCKET_PICKUP_METADATA_KEY
    )
  })

  it("returns undefined for a carrier it does not know", () => {
    expect(carrierPickupMetadataKey("bluedart")).toBeUndefined()
    expect(carrierPickupMetadataKey("")).toBeUndefined()
  })

  /**
   * The two keys must stay distinct. If they ever collapsed, a location
   * registered with one carrier would read as registered with the other and
   * `ensureCarrierPickup` would return a name the carrier has never seen.
   */
  it("keeps the two registries from colliding", () => {
    expect(SHIPROCKET_PICKUP_METADATA_KEY).not.toBe(
      DELHIVERY_WAREHOUSE_METADATA_KEY
    )
  })
})
