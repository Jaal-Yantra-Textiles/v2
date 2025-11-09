import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createFeedbackWithLinkWorkflow } from "../../../../../workflows/feedback/create-feedback-with-link";
import { Feedback } from "../../../feedbacks/validators";

/**
 * GET /admin/partners/[id]/feedbacks
 * Lists all feedbacks linked to a specific partner
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const partnerId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  try {
    // Query all feedbacks linked to this partner
    const { data: partnerData } = await query.index({
      entity: "partner",
      fields: ["feedbacks.*"],
      filters: {
        id: partnerId,
      },
    });

    // Extract the feedbacks from the partner object
    const feedbacks =
      partnerData && partnerData.length > 0 && partnerData[0].feedbacks
        ? partnerData[0].feedbacks
        : [];

    return res.json({
      feedbacks: feedbacks,
      count: feedbacks.length,
    });
  } catch (error) {
    console.error("Error fetching partner feedbacks:", error);
    return res.status(500).json({
      message: "Failed to fetch partner feedbacks",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * POST /admin/partners/[id]/feedbacks
 * Creates a new feedback and links it to the partner
 */
export const POST = async (
  req: MedusaRequest<Feedback>,
  res: MedusaResponse
) => {
  const partnerId = req.params.id;

  try {
    const { result } = await createFeedbackWithLinkWorkflow(req.scope).run({
      input: {
        ...req.validatedBody,
        link_to: {
          partner_id: partnerId,
        },
      },
    });

    return res.status(201).json({
      feedback: result.feedback,
    });
  } catch (error) {
    console.error("Error creating partner feedback:", error);
    return res.status(500).json({
      message: "Failed to create partner feedback",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
