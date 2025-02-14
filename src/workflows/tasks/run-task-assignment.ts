import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { TASKS_MODULE } from "../../modules/tasks"

type AssignTaskWorkFlowInput = {
    taskId: string,
    partnerId: string
}

const notifyPartnerStep = createStep(
   {
        name: 'notify-partner',
        async: true,
   },
    async (input: {input: AssignTaskWorkFlowInput, task: any}, { container }) => {
        const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
        logger.info("Notifying partner...")
        const eventService = container.resolve(Modules.EVENT_BUS)
        if (input.task.eventable){
            logger.info("Partner notified...")
            eventService.emit({
                name: "task_assigned",
                data: {
                    task_id: input.input.taskId,
                    partner_id: input.input.partnerId
                }
            })
        }
    }
)

const awaitTaskClaim = createStep(
    {
        name: 'await-task-claim',
        async: true,
        timeout: 60 * 15,
        maxRetries: 2
    },
    async (_, { container }) => {
        const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
        logger.info("Awaiting task claim...")
    }
)


const awaitTaskFinish = createStep(
    {
        name: 'await-task-finish',
        async: true,
        timeout: 60 * 15,
        maxRetries: 2
    },
    async (_, { container }) => {
        const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
        logger.info("Awaiting task finish...")
    }
)

const setTransactionID = createStep(
    "set-transaction-id-for-task",
    async (input: {input: AssignTaskWorkFlowInput, task: any}, { container, context }) => {
       const taskService = container.resolve(TASKS_MODULE);
       const task = await taskService.updateTasks({
           id: input.task.id,
           transaction_id: context.transactionId
       })
       return new StepResponse(task, task.id)
    },
    async (_, { container }) => {
        const taskService = container.resolve(TASKS_MODULE);
         await taskService.updateTasks({
            id: _.id,
            transaction_id: null
        })
    }
)

export const runTaskAssignmentWorkflow = createWorkflow(
   {
    name: 'run-task-assignment',
    store: true
   },
    (input: {input: AssignTaskWorkFlowInput, task: any}) => {
        setTransactionID(input)
        notifyPartnerStep(input)
        awaitTaskClaim()
        awaitTaskFinish()
        // So, these long workflows, are good  now we can run like bill submitted and etc 
        // Create and arrange the order of the workflows,
        return new WorkflowResponse('Success')
    }
)


