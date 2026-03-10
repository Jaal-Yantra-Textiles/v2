import { MedusaService } from "@medusajs/framework/utils";
import Design from "./models/design";
import DesignSpecification from "./models/design_specification";
import DesignColor from "./models/design_color";
import DesignSizeSet from "./models/design_size_set";
import DesignComponent from "./models/design_component";

class DesignService extends MedusaService({
  Design,
  DesignSpecification,
  DesignColor,
  DesignSizeSet,
  DesignComponent,
}) {
  constructor() {
    super(...arguments)
  }
}

export default DesignService;
