import { Module } from "@medusajs/framework/utils"
import PaymentSubmissionsService from "./service"

export const PAYMENT_SUBMISSIONS_MODULE = "payment_submissions"

const PaymentSubmissionsModule = Module(PAYMENT_SUBMISSIONS_MODULE, {
  service: PaymentSubmissionsService,
})

export { PaymentSubmissionsModule }
export default PaymentSubmissionsModule
