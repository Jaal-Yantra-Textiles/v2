import { MedusaService } from "@medusajs/framework/utils";
import Agreement from "./models/agreement";

class AgreementsService extends MedusaService({
  Agreement,
}) {}

export default AgreementsService;
