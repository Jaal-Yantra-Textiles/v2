import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createFeedbackWithLinkWorkflow } from "../../../../../workflows/feedback/create-feedback-with-link";
import { Feedback } from "../../../feedbacks/validators";

/**
 * GET /admin/tasks/[id]/feedbacks
 * Lists all feedbacks linked to a specific task
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const taskId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  try {
    // Query all feedbacks linked to this task
    const { data: taskData } = await query.index({
      entity: "task",
      fields: ["feedbacks.*"],
      filters: {
        id: taskId,
      },
    });

    // Extract the feedbacks from the task object
    const feedbacks =
      taskData && taskData.length > 0 && taskData[0].feedbacks
        ? taskData[0].feedbacks
        : [];

    return res.json({
      feedbacks: feedbacks,
      count: feedbacks.length,
    });
  } catch (error) {
    console.error("Error fetching task feedbacks:", error);
    return res.status(500).json({
      message: "Failed to fetch task feedbacks",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * POST /admin/tasks/[id]/feedbacks
 * Creates a new feedback and links it to the task
 */
export const POST = async (
  req: MedusaRequest<Feedback>,
  res: MedusaResponse
) => {
  const taskId = req.params.id;

  try {
    const { result } = await createFeedbackWithLinkWorkflow(req.scope).run({
      input: {
        ...req.validatedBody,
        link_to: {
          task_id: taskId,
        },
      },
    });

    return res.status(201).json({
      feedback: result.feedback,
    });
  } catch (error) {
    console.error("Error creating task feedback:", error);
    return res.status(500).json({
      message: "Failed to create task feedback",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
