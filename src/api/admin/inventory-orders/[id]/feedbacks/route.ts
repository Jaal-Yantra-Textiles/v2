import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createFeedbackWithLinkWorkflow } from "../../../../../workflows/feedback/create-feedback-with-link";
import { Feedback } from "../../../feedbacks/validators";

/**
 * GET /admin/inventory-orders/[id]/feedbacks
 * Lists all feedbacks linked to a specific inventory order
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const inventoryOrderId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  try {
    // Query all feedbacks linked to this inventory order
    const { data: orderData } = await query.index({
      entity: "inventory_orders",
      fields: ["feedbacks.*"],
      filters: {
        id: inventoryOrderId,
      },
    });

    // Extract the feedbacks from the inventory order object
    const feedbacks =
      orderData && orderData.length > 0 && orderData[0].feedbacks
        ? orderData[0].feedbacks
        : [];

    return res.json({
      feedbacks: feedbacks,
      count: feedbacks.length,
    });
  } catch (error) {
    console.error("Error fetching inventory order feedbacks:", error);
    return res.status(500).json({
      message: "Failed to fetch inventory order feedbacks",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * POST /admin/inventory-orders/[id]/feedbacks
 * Creates a new feedback and links it to the inventory order
 */
export const POST = async (
  req: MedusaRequest<Feedback>,
  res: MedusaResponse
) => {
  const inventoryOrderId = req.params.id;

  try {
    const { result } = await createFeedbackWithLinkWorkflow(req.scope).run({
      input: {
        ...req.validatedBody,
        link_to: {
          inventory_order_id: inventoryOrderId,
        },
      },
    });

    return res.status(201).json({
      feedback: result.feedback,
    });
  } catch (error) {
    console.error("Error creating inventory order feedback:", error);
    return res.status(500).json({
      message: "Failed to create inventory order feedback",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
