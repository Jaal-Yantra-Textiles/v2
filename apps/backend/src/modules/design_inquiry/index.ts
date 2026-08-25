import { Module } from "@medusajs/framework/utils"

import DesignInquiryService from "./service"

export const DESIGN_INQUIRY_MODULE = "design_inquiry"

export default Module(DESIGN_INQUIRY_MODULE, {
  service: DesignInquiryService,
})
