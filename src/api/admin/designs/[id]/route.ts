import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { UpdateDesign } from "../validators";
import updateDesignWorkflow from "../../../../workflows/designs/update-design";
import deleteDesignWorkflow from "../../../../workflows/designs/delete-design";
import { DesignAllowedFields, refetchDesign } from "../helpers";
import listSingleDesignsWorkflow from "../../../../workflows/designs/list-single-design";

// GET single design
// @todo Have to change this to use for the workflow
export const GET = async (
  req: MedusaRequest & {
    params: { id: string };
    remoteQueryConfig?: {
      fields?: DesignAllowedFields[];
    };
  },
  res: MedusaResponse
) => {
  try {
    const {result} = await listSingleDesignsWorkflow.run({
      input: {
        id: req.params.id,
      },
    })
   
    res.status(200).json({ design: result });
  } catch (error) {
    res.status(404).json({ error: "Design not found" });
  }
};

// Update design
export const PUT = async (
  req: MedusaRequest<UpdateDesign> & {
    params: { id: string };
    remoteQueryConfig?: {
      fields?: DesignAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  console.log(req.body)
  const { result, errors } = await updateDesignWorkflow.run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const design = await refetchDesign(
    req.params.id,
    req.scope,
    req.remoteQueryConfig?.fields || ["*"],
  );

  res.status(200).json({ design });
};

// Delete design
export const DELETE = async (
  req: MedusaRequest & {
    params: { id: string };
  },
  res: MedusaResponse,
) => {
  const { errors } = await deleteDesignWorkflow.run({
    input: {
      id: req.params.id,
    },
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  res.status(204).send();
};
