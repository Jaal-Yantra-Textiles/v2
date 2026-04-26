import { Module } from "@medusajs/framework/utils";
import AgreementsService from "./service";

export const AGREEMENTS_MODULE = "agreements";

const AgreementsModule = Module(AGREEMENTS_MODULE, {
  service: AgreementsService,
});

export default AgreementsModule;
