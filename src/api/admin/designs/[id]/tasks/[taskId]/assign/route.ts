import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework";
import { createTaskAssignmentWorkflow } from "../../../../../../../workflows/tasks/create-task-assignment";
import { runTaskAssignmentWorkflow } from "../../../../../../../workflows/tasks/run-task-assignment";
import { AdminPostDesignTaskAssignReq } from "./validators";

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

    await runTaskAssignmentWorkflow(req.scope).run({
        input: {
            input: {
                taskId: req.validatedBody.taskId,
                partnerId: req.validatedBody.partnerId
            },
            task: task
        }
    })


   

    return res.json({
        task
    })
}