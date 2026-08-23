import { Module } from "@medusajs/framework/utils"

import PaymentScheduleService from "./service"

export const PAYMENT_SCHEDULE_MODULE = "payment_schedule"

const PaymentScheduleModule = Module(PAYMENT_SCHEDULE_MODULE, {
  service: PaymentScheduleService,
})

export { PaymentScheduleModule }

export default PaymentScheduleModule
