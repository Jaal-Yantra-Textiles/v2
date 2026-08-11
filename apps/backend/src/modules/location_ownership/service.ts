import { MedusaService } from "@medusajs/framework/utils"

import LocationOwnership from "./models/location-ownership"

/**
 * location_ownership module service — which stock locations are ours.
 *
 * The generated `listLocationOwnerships` / `createLocationOwnerships` /
 * `updateLocationOwnerships` are all this needs; the interesting logic is the
 * resolution in `workflows/consumption-logs/lib/apply-to-inventory.ts`.
 */
class LocationOwnershipService extends MedusaService({
  LocationOwnership,
}) {}

export default LocationOwnershipService
