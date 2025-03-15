import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework";
import { RAW_MATERIAL_MODULE } from "../../../../../../modules/raw_material";
import RawMaterialService from "../../../../../../modules/raw_material/service";
import updateRawMaterialWorkflow from "../../../../../../workflows/raw-materials/update-raw-material";
import { UpdateRawMaterial } from "../validators";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const rawMaterialService: RawMaterialService = req.scope.resolve(RAW_MATERIAL_MODULE);
  const { rawMaterialId } = req.params;

  try {
    const rawMaterial = await rawMaterialService.retrieveRawMaterial(rawMaterialId, {
      relations: ["material_type"],
    });
    res.status(200).json({ raw_material: rawMaterial });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
};

export const PUT = async (
  req: MedusaRequest<UpdateRawMaterial>,
  res: MedusaResponse,
) => {
  const { rawMaterialId } = req.params;

  const {  errors } = await updateRawMaterialWorkflow(req.scope).run({
    input: {
      id: rawMaterialId,
      update: req.validatedBody.rawMaterialData || {}
    },
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  // Fetch the updated raw material
  const rawMaterialService: RawMaterialService = req.scope.resolve(RAW_MATERIAL_MODULE);
  const rawMaterial = await rawMaterialService.retrieveRawMaterial(rawMaterialId, {
    relations: ["material_type"],
  });

  res.status(200).json({ raw_material: rawMaterial });
};

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const rawMaterialService: RawMaterialService = req.scope.resolve(RAW_MATERIAL_MODULE);
  const { rawMaterialId } = req.params;

  try {
    await rawMaterialService.deleteRawMaterials([rawMaterialId]);
    res.status(200).json({
      id: rawMaterialId,
      object: "raw_material",
      deleted: true,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
