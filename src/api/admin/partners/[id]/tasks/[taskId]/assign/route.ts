import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework";
import { createTaskAssignmentWorkflow } from "../../../../../../../workflows/tasks/create-task-assignment";
import { runTaskAssignmentWorkflow } from "../../../../../../../workflows/tasks/run-task-assignment";
import { setStepSuccessWorkflow } from "../../../../../../../workflows/tasks/task-engine/task-steps";
import { AdminPostPartnerTaskAssignReq } from "./validators";


/**
 * POST /admin/partners/[id]/tasks/[taskId]/assign
 * Admin assigns a task to a partner
 * Mimics the design task assignment workflow
 */
export const POST = async (req: MedusaRequest<AdminPostPartnerTaskAssignReq>, res: MedusaResponse) => {
    const partnerId = req.params.id;
    const taskId = req.params.taskId;

    // Create the partner-task link
    await createTaskAssignmentWorkflow(req.scope).run({
        input: {
            taskId: taskId,
            partnerId: partnerId
        }
    });

    // Refetch the task with partner data
    const task = await refetchEntity(
        "task",
        taskId,
        req.scope,
        ["*", 'partner.*']
    );

    // Run the assignment workflow (notify partner, await acceptance, await completion)
    const { transaction } = await runTaskAssignmentWorkflow(req.scope).run({
        input: {
            input: {
                taskId: taskId,
                partnerId: partnerId
            },
            task: task
        }
    });

    const postTaskTransactionId = {
        transaction_id: transaction.transactionId
    };

    /**
     * Signal that the partner has been notified
     */
    await setStepSuccessWorkflow(req.scope).run({
        input: {
            stepId: 'notify-partner',
            updatedTask: postTaskTransactionId
        }
    }).catch((error) => {
        throw error;
    });

    return res.json({
        task
    });
}
