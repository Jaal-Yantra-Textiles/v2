import { Module } from "@medusajs/framework/utils";
import hyperbeeDalLoader from "./loaders/hyperbee-dal";
import CrmService from "./service";

export const CRM_MODULE = "crm";

export default Module(CRM_MODULE, {
  service: CrmService,
  // Hyperbee-only DAL — no Postgres tables for CRM. The loader always runs and
  // overrides the module container's per-model services + baseRepository.
  loaders: [hyperbeeDalLoader],
});
