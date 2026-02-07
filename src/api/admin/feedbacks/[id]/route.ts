
/**
 * API route: /admin/feedbacks/:id
 *
 * Handlers:
 *  - GET  -> Fetch a single feedback by id.
 *  - POST -> Update a feedback by id using the validated UpdateFeedback body.
 *  - DELETE -> Delete a feedback by id.
 *
 * Behavior:
 *  - GET
 *    - Uses listFeedbackWorkflow to load a feedback filtered by id.
 *    - Response: 200 { feedback: Feedback | null }
 *
 *  - POST
 *    - Expects a validated body shaped like UpdateFeedback.
 *    - Uses updateFeedbackWorkflow to apply updates.
 *    - Response: 200 { feedback: Feedback }
 *
 *  - DELETE
 *    - Uses deleteFeedbackWorkflow to remove the feedback.
 *    - Response: 200 { id: string, object: "feedback", deleted: true }
 *
 * Parameters (via request):
 *  - req.params.id: string — the feedback id to operate on.
 *  - req.scope: Dependency injection scope passed to workflows.
 *  - req.validatedBody (POST only): UpdateFeedback — validated update payload.
 *
 * Errors:
 *  - Workflow-level validation or persistence errors propagate and should be handled by upstream error middleware.
 *
 * Examples:
 *
 * 1) GET a feedback (curl)
 *    curl -X GET "https://example.com/admin/feedbacks/{id}" \
 *      -H "Authorization: Bearer {admin_token}" \
 *      -H "Content-Type: application/json"
 *
 * 2) GET a feedback (fetch)
 *    const res = await fetch(`/admin/feedbacks/${id}`, {
 *      method: "GET",
 *      headers: { Authorization: `Bearer ${token}` }
 *    });
 *    const body = await res.json(); // { feedback: { ... } }
 *
 * 3) Update a feedback (curl)
 *    curl -X POST "https://example.com/admin/feedbacks/{id}" \
 *      -H "Authorization: Bearer {admin_token}" \
 *      -H "Content-Type: application/json" \
 *      -d '{"status":"reviewed","notes":"Updated by admin"}'
 *
 * 4) Update a feedback (fetch)
 *    const res = await fetch(`/admin/feedbacks/${id}`, {
 *      method: "POST",
 *      headers: {
 *        Authorization: `Bearer ${token}`,
 *        "Content-Type": "application/json"
 *      },
 *      body: JSON.stringify({ status: "reviewed", notes: "Updated by admin" })
 *    });
 *    const body = await res.json(); // { feedback: { ... } }
 *
 * 5) Delete a feedback (curl)
 *    curl -X DELETE "https://example.com/admin/feedbacks/{id}" \
 *      -H "Authorization: Bearer {admin_token}"
 *
 * 6) Delete a feedback (fetch)
 *    const res = await fetch(`/admin/feedbacks/${id}`, {
 *      method: "DELETE",
 *      headers: { Authorization: `Bearer ${token}` }
 *    });
 *    const body = await res.json(); // { id, object: "feedback", deleted: true }
 *
 * Types referenced:
 *  - UpdateFeedback: shape of the validated update payload (fields validated by validators).
 *  - Feedback: the feedback entity returned by workflows (properties depend on your domain model).
 *
 * Notes:
 *  - Ensure authentication/authorization is enforced upstream (this file expects admin access).
 *  - Workflows are executed with req.scope to resolve service dependencies.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdateFeedback } from "../validators";
import { listFeedbackWorkflow } from "../../../../workflows/feedback/list-feedback";
import { updateFeedbackWorkflow } from "../../../../workflows/feedback/update-feedback";
import { deleteFeedbackWorkflow } from "../../../../workflows/feedback/delete-feedback";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listFeedbackWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ feedback: result[0][0] });
};

export const POST = async (req: MedusaRequest<UpdateFeedback>, res: MedusaResponse) => {
  const { result } = await updateFeedbackWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });
  res.status(200).json({ feedback: result });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteFeedbackWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "feedback",
    deleted: true,
  });
};
