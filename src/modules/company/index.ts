import { Module } from "@medusajs/framework/utils";
import CompanyService from "./service";

export const COMPANY_MODULE = "companies";

const CompanyModule = Module(COMPANY_MODULE, {
  service: CompanyService,
});

export { CompanyModule }

export default CompanyModule
