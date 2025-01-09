import { MedusaService } from "@medusajs/framework/utils";
import Design from "./models/design";
import DesignSpecification from "./models/design_specification";

class DesignService extends MedusaService({
  Design,
  DesignSpecification,
}) {
  constructor() {
    super(...arguments)
  }
}

export default DesignService;
