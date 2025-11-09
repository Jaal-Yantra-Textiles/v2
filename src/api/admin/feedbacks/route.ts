import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { Feedback } from "./validators";
import { createFeedbackWorkflow } from "../../../workflows/feedback/create-feedback";
import { listFeedbackWorkflow } from "../../../workflows/feedback/list-feedback";

export const GET = async (
  req: MedusaRequest & {
    query?: {
      offset?: number;
      limit?: number;
      rating?: "one" | "two" | "three" | "four" | "five";
      status?: "pending" | "reviewed" | "resolved";
      submitted_by?: string;
      reviewed_by?: string;
      include_partners?: string;
      include_tasks?: string;
      include_inventory_orders?: string;
    };
  },
  res: MedusaResponse
) => {
  const offset = Number(req.query?.offset ?? 0);
  const limit = Number(req.query?.limit ?? 20);

  // Parse include flags
  const includePartners = req.query?.include_partners === "true";
  const includeTasks = req.query?.include_tasks === "true";
  const includeInventoryOrders = req.query?.include_inventory_orders === "true";

  const { result } = await listFeedbackWorkflow(req.scope).run({
    input: {
      filters: {
        rating: req.query?.rating,
        status: req.query?.status,
        submitted_by: req.query?.submitted_by,
        reviewed_by: req.query?.reviewed_by,
      },
      config: {
        skip: offset,
        take: limit,
      },
      includeLinks: {
        partners: includePartners,
        tasks: includeTasks,
        inventoryOrders: includeInventoryOrders,
      },
    },
  });

  const feedbacks = result[0] || [];
  const count = result[1] || 0;

  res.status(200).json({
    feedbacks,
    count,
    offset,
    limit,
  });
};

export const POST = async (req: MedusaRequest<Feedback>, res: MedusaResponse) => {
  const { result } = await createFeedbackWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  res.status(201).json({ feedback: result });
};
