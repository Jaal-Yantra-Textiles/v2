import { Module } from "@medusajs/framework/utils";
import Payment_reportsService from "./service";

export const PAYMENT_REPORTS_MODULE = "payment_reports";

const Payment_reportsModule = Module(PAYMENT_REPORTS_MODULE, {
  service: Payment_reportsService,
});

export default Payment_reportsModule;
