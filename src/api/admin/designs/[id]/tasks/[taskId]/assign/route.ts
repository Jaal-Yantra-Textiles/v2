import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework";
import { createTaskAssignmentWorkflow } from "../../../../../../../workflows/tasks/create-task-assignment";
import { runTaskAssignmentWorkflow } from "../../../../../../../workflows/tasks/run-task-assignment";
import { AdminPostDesignTaskAssignReq } from "./validators";
import { setStepSuccessWorkflow } from "../../../../../../../workflows/tasks/task-engine/task-steps";

export const POST = async (req: MedusaRequest<AdminPostDesignTaskAssignReq>, res: MedusaResponse) => {

    const {result: taskLinked } = await createTaskAssignmentWorkflow(req.scope).run({
        input: {
            taskId: req.validatedBody.taskId,
            partnerId: req.validatedBody.partnerId
        }
        
    })

    const task = await refetchEntity(
        "task",
        req.validatedBody.taskId,
        req.scope,
        ["*", 'partner.*']
      )

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