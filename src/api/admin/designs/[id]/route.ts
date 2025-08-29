import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { UpdateDesign } from "../validators";
import updateDesignWorkflow from "../../../../workflows/designs/update-design";
import deleteDesignWorkflow from "../../../../workflows/designs/delete-design";
import { DesignAllowedFields, refetchDesign } from "../helpers";
import listSingleDesignsWorkflow from "../../../../workflows/designs/list-single-design";


export const GET = async (
  req: MedusaRequest & {
    params: { id: string };
    // validatedQuery is populated by middleware; `fields` arrives as a comma-separated string
    validatedQuery?: { fields?: string };
  },
  res: MedusaResponse
) => {
  // Extract fields from validated query and convert to array for the workflow
  const fieldsStr = req.validatedQuery?.fields;
  const fields = fieldsStr
    ? fieldsStr.split(",").map((f) => f.trim()).filter(Boolean)
    : ["*"];

  const { result } = await listSingleDesignsWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      fields,
    },
  });

  res.status(200).json({ design: result });
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

  res.status(201).send({
    id: req.params.id,
    object: "design",
    deleted: true,
  });
};
