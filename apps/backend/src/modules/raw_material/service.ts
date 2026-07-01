import { MedusaService } from "@medusajs/framework/utils";
import RawMaterial from "./models/raw_material";
import MaterialType from "./models/material_type";
import RawMaterialGroup from "./models/raw_material_group";


class RawMaterialService extends MedusaService({
  RawMaterial,
  MaterialType,
  RawMaterialGroup,
}) {
  constructor() {
    super(...arguments)
  }
}

export default RawMaterialService;
