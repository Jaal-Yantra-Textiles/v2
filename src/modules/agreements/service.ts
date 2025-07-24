import { MedusaService } from "@medusajs/framework/utils";
import Agreement from "./models/agreement";
import AgreementResponse from "./models/agreement-response";

class AgreementsService extends MedusaService({
  Agreement,
  AgreementResponse,
}) {
  // Service will automatically provide CRUD operations for Agreement and AgreementResponse models
}

export default AgreementsService;
