import { MedusaService } from "@medusajs/framework/utils";
import RawMaterial from "./models/raw_material";
import MaterialType from "./models/material_type";
import IsRawMaterial from "./models/is_raw_material";

class RawMaterialService extends MedusaService({
  RawMaterial,
  MaterialType,
  IsRawMaterial
}) {
  constructor() {
    super(...arguments)
  }
}

export default RawMaterialService;
