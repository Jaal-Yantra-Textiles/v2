import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { updateTaskWorkflow } from "../../../../../workflows/tasks/update-task";
import { setStepSuccessWorkflow } from "../../../../../workflows/tasks/task-engine/task-steps";
import { Status } from "../../../../../workflows/tasks/create-task";

export async function POST(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {

    const taskId = req.params.taskId
    
    const { result, errors } = await updateTaskWorkflow(req.scope).run({
        input: {
            id: taskId,
            update:{
                status: Status.completed
            }
        }
    })

    // Partner will submit the bill also alonside , either pre-agreed
    // or through the task form
    
    if (errors && errors.length > 0) {    
        console.warn("Error reported at", errors);
        throw errors;
    }

    const setStepSuccess = await setStepSuccessWorkflow(req.scope).run({
        input: {
            stepId: 'await-task-finish',
            updatedTask: result[0]
        }
    })
    
    res.status(200).json({ 
        task: result[0],
    })

}
