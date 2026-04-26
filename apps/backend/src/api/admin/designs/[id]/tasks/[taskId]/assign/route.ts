/**
 * POST /admin/designs/:id/tasks/:taskId/assign
 *
 * Summary
 * Assign a partner to a design task. This endpoint validates the request body,
 * starts the task assignment workflow, runs the assignment (notifying the partner),
 * and marks the notify-partner step as successful. Returns the updated task (including partner).
 *
 * Authentication
 * - Admin bearer token required: Authorization: Bearer <ADMIN_TOKEN>
 *
 * Request body (AdminPostDesignTaskAssignReq)
 * {
 *   "taskId": string,    // ID of the task to assign (should match :taskId)
 *   "partnerId": string  // ID of the partner to assign to the task
 * }
 *
 * Responses
 * - 200 OK
 *   {
 *     "task": { ... } // The refreshed task entity with partner relation (fields: *, partner.*)
 *   }
 * - 400 Bad Request - validation failed
 * - 401 Unauthorized - missing/invalid admin credentials
 * - 404 Not Found - task or partner not found
 * - 500 Internal Server Error - workflow failure or unexpected error
 *
 * Examples
 *
 * Curl
 * curl -X POST "https://api.example.com/admin/designs/<designId>/tasks/<taskId>/assign" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "taskId": "<taskId>",
 *     "partnerId": "<partnerId>"
 *   }'
 *
 * JavaScript (fetch)
 * await fetch(`/admin/designs/${designId}/tasks/${taskId}/assign`, {
 *   method: "POST",
 *   headers: {
 *     "Authorization": `Bearer ${ADMIN_TOKEN}`,
 *     "Content-Type": "application/json"
 *   },
 *   body: JSON.stringify({ taskId, partnerId })
 * }).then(res => res.json())
 *
 * Notes
 * - The endpoint triggers these workflows: createTaskAssignmentWorkflow, runTaskAssignmentWorkflow, setStepSuccessWorkflow.
 * - After successful execution the partner will be notified and the notify-partner workflow step is marked as successful.
 */
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework";
import { createTaskAssignmentWorkflow } from "../../../../../../../workflows/tasks/create-task-assignment";
import { runTaskAssignmentWorkflow } from "../../../../../../../workflows/tasks/run-task-assignment";
import { AdminPostDesignTaskAssignReq } from "./validators";
import { setStepSuccessWorkflow } from "../../../../../../../workflows/tasks/task-engine/task-steps";

export const POST = async (req: MedusaRequest<AdminPostDesignTaskAssignReq>, res: MedusaResponse) => {

    await createTaskAssignmentWorkflow(req.scope).run({
        input: {
            taskId: req.validatedBody.taskId,
            partnerId: req.validatedBody.partnerId
        }
        
    })

    const task = await refetchEntity({
        entity: "task",
        idOrFilter: req.validatedBody.taskId,
        scope: req.scope,
        fields: ["*", 'partner.*']
      })

    const { transaction } = await runTaskAssignmentWorkflow(req.scope).run({
        input: {
            input: {
                taskId: req.validatedBody.taskId,
                partnerId: req.validatedBody.partnerId
            },
            task: task
        }
    })
    const postTaskTransctionId = {
        transaction_id: transaction.transactionId
    }
    /**
     * Here the partner has been notified
     */
    await setStepSuccessWorkflow(req.scope).run({
        input: {
            stepId: 'notify-partner',
            updatedTask: postTaskTransctionId
        }
    }).catch((error) => {
        throw error;
    })


   

    return res.json({
        task
    })
}