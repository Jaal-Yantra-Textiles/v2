import { MedusaService } from "@medusajs/framework/utils";
import PersonProperty from "./models/person_property";

class PersonPropertyService extends MedusaService({
  PersonProperty,
}) {}

export default PersonPropertyService;
