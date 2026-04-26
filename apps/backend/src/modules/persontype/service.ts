import { MedusaService } from "@medusajs/framework/utils";
import PersonType from "../persontype/models/persontype";

class PersonTypeService extends MedusaService({
  PersonType,
}) {
  // Custom methods can be added here
}

export default PersonTypeService;
