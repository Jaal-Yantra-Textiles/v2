import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import DesignService from "../../../modules/designs/service";
import { DESIGN_MODULE } from "../../../modules/designs";
import { Design } from "./validators";
import createDesignWorkflow from "../../../workflows/designs/create-design";
import listDesignsWorkflow from "../../../workflows/designs/list-designs";
import { DesignAllowedFields, refetchDesign } from "./helpers";

// Create new design
export const POST = async (
  req: MedusaRequest<Design> & {
    remoteQueryConfig?: {
      fields?: DesignAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const { result, errors } = await createDesignWorkflow.run({
    input: req.validatedBody,
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const design = await refetchDesign(
    result.id,
    req.scope,
    req.remoteQueryConfig?.fields || ["*"],
  );

  res.status(201).json({ design });
};

// List all designs
export const GET = async (
  req: MedusaRequest & {
    query: {
      offset?: number;
      limit?: number;
      name?: string;
      design_type?: "Original" | "Derivative" | "Custom" | "Collaboration";
      status?: "Conceptual" | "In_Development" | "Technical_Review" | "Sample_Production" | "Revision" | "Approved" | "Rejected" | "On_Hold";
      priority?: "Low" | "Medium" | "High" | "Urgent";
      tags?: string[];
    };
  },
  res: MedusaResponse
) => {

  try {
    const { result, errors } = await listDesignsWorkflow.run({
      input: {
        pagination: {
          offset: Number(req.query.offset) || 0,
          limit: Number(req.query.limit) || 10,
        },
        filters: {
          name: req.query.name,
          design_type: req.query.design_type,
          status: req.query.status,
          priority: req.query.priority,
          tags: req.query.tags,
        },
      },
    });

  

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    const { designs, count } = result;

    res.status(200).json({
      designs,
      count,
      offset: req.query.offset || 0,
      limit: req.query.limit || 10,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
