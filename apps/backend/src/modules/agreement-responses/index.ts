import { Module } from "@medusajs/framework/utils";
import AgreementResponseService from "./service";

export const AGREEMENT_RESPONSE_MODULE = "agreementResponse";

const AgreementResponseModule = Module(AGREEMENT_RESPONSE_MODULE, {
  service: AgreementResponseService,
});

export default AgreementResponseModule;
