import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { updateTaskWorkflow } from "../../../../../workflows/tasks/update-task";
import { setStepSuccessWorkflow } from "../../../../../workflows/tasks/task-engine/task-steps";

export async function POST(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {

    const taskId = req.params.taskId
    
    const { result, errors } = await updateTaskWorkflow(req.scope).run({
        input: {
            id: taskId,
            update:{
                status: "accepted"
            }
        }
    })
    
    if (errors && errors.length > 0) {    
        console.warn("Error reported at", errors);
        throw errors;
    }

    const setStepSuccess = await setStepSuccessWorkflow(req.scope).run({
        input: {
            stepId: 'notify-partner',
            updatedTask: result
        }
        
    }).catch((error) => {
        throw error;
    })


    
    res.status(200).json({ 
        task: result,
    })

}
