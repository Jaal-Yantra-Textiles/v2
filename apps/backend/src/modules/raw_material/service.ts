import { MedusaService } from "@medusajs/framework/utils";
import RawMaterial from "./models/raw_material";
import MaterialType from "./models/material_type";


class RawMaterialService extends MedusaService({
  RawMaterial,
  MaterialType,
}) {
  constructor() {
    super(...arguments)
  }
}

export default RawMaterialService;
