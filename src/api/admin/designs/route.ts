import {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

import { Design } from "./validators";
import createDesignWorkflow from "../../../workflows/designs/create-design";
import listDesignsWorkflow from "../../../workflows/designs/list-designs";
import { DesignAllowedFields, refetchDesign } from "./helpers";
import { DateComparisonOperator } from "@medusajs/types";

// Create new design
export const POST = async (
  req: AuthenticatedMedusaRequest<Design> & {
    remoteQueryConfig?: {
      fields?: DesignAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const adminId = req.auth_context?.actor_id;

  if (!adminId) {
    return res.status(401).json({ message: "Admin authentication required" });
  }

  const { result, errors } = await createDesignWorkflow(req.scope).run({
    input: {
      ...req.validatedBody,
      origin_source: req.validatedBody?.origin_source ?? "manual",
    },
  })

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
      partner_id?: string;
      created_at?: DateComparisonOperator;
      target_completion_date?: DateComparisonOperator;
    };
  },
  res: MedusaResponse
) => {

  try {
    const { result, errors } = await listDesignsWorkflow(req.scope).run({
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
          partner_id: req.query.partner_id,
          created_at: req.query.created_at,
          target_completion_date: req.query.target_completion_date,
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
