import { Module } from "@medusajs/framework/utils"

import TextileAnalysisService from "./service"

export const TEXTILE_ANALYSIS_MODULE = "textile_analysis"

export default Module(TEXTILE_ANALYSIS_MODULE, {
  service: TextileAnalysisService,
})
