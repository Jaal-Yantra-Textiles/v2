import { MedusaService } from "@medusajs/framework/utils";
import AgreementResponse from "./models/agreement-response";

class AgreementResponseService extends MedusaService({
  AgreementResponse,
}) {}

export default AgreementResponseService;
