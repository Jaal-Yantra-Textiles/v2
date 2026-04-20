import { Module } from "@medusajs/framework/utils"
import StatsService from "./service"

export const STATS_MODULE = "stats"

export default Module(STATS_MODULE, {
  service: StatsService,
})
