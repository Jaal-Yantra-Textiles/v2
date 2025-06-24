import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { RawMaterial } from "./validators";
import { createRawMaterialWorkflow } from "../../../../../workflows/raw-materials/create-raw-material";
import { RawMaterialAllowedFields, refetchRawMaterial } from "./helpers";

export const POST = async (
  req: MedusaRequest<RawMaterial> & {
    remoteQueryConfig?: {
      fields?: RawMaterialAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const { errors } = await createRawMaterialWorkflow(req.scope).run({
    input: {
      inventoryId: req.params.id,
      rawMaterialData: req.validatedBody.rawMaterialData
    },
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const rawMaterial = await refetchRawMaterial(
    req.params.id,
    req.scope,
    req.remoteQueryConfig?.fields || ["*"],
  );

  res.status(201).json( rawMaterial );
};
