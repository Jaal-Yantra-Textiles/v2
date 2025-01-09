import { Module } from "@medusajs/framework/utils";
import InternalPaymentService from "./service";

export const INTERNAL_PAYMENT_MODULE = "internal_payments";

const InternalPaymentModule = Module(INTERNAL_PAYMENT_MODULE, {
  service: InternalPaymentService,
});

export { InternalPaymentModule }

export default InternalPaymentModule
