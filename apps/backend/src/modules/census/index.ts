import { Module } from "@medusajs/framework/utils"

import CensusModuleService from "./service"
import p2pReaderLoader from "./loaders/p2p-reader"

export const CENSUS_MODULE = "census"

export default Module(CENSUS_MODULE, {
  service: CensusModuleService,
  loaders: [p2pReaderLoader],
})
