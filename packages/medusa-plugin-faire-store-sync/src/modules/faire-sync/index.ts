import { Module } from "@medusajs/framework/utils"
import FaireSyncService from "./service"

export const FAIRE_SYNC_MODULE = "faireSync"

const FaireSyncModule = Module(FAIRE_SYNC_MODULE, {
  service: FaireSyncService,
})

export default FaireSyncModule
export { FaireSyncService }
