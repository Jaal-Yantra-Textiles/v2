import { Module } from "@medusajs/framework/utils"

import LocationOwnershipService from "./service"

export const LOCATION_OWNERSHIP_MODULE = "location_ownership"

export default Module(LOCATION_OWNERSHIP_MODULE, {
  service: LocationOwnershipService,
})
