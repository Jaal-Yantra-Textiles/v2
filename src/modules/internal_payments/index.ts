import { Module } from "@medusajs/framework/utils";
import InternalPaymentService from "./service";

export const INTERNAL_PAYMENTS_MODULE = "internal_payments";

const InternalPaymentModule = Module(INTERNAL_PAYMENTS_MODULE, {
  service: InternalPaymentService,
});

export { InternalPaymentModule }

export default InternalPaymentModule
