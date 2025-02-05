/**
 * We are going to receive the created tasks
 * Then we are also going to receive the design id with partner ID or person ID
 * We are going to then link either of them 
 * These linking will ensure that the tasks are linked to the design
 * Partners and People associated
 */

import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import TaskService from "../../modules/tasks/service"
import { TASKS_MODULE } from "../../modules/tasks"

import PartnerService from "../../modules/partner/service"
import { PARTNER_MODULE } from "../../modules/partner"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { LinkDefinition } from "@medusajs/framework/types"


type AssignTaskWorkFlowInput = {
    taskId: string
    partnerId: string
}

const validateTaskStep = createStep(
    "validate-task",
    async (input: AssignTaskWorkFlowInput, { container }) => {
        const taskService: TaskService = container.resolve(TASKS_MODULE);
        const task = await taskService.retrieveTask(input.taskId)
        return new StepResponse(task)
    }
)

const validateParnter = createStep(
    "validate-partner",
    async (input: AssignTaskWorkFlowInput, { container }) => {
        const partnerService: PartnerService = container.resolve(PARTNER_MODULE);
        const task = await partnerService.retrievePartner(input.partnerId)
    }
)

const linkTaskStep = createStep(
    "link-task",
    async (input: AssignTaskWorkFlowInput, { container }) => {
        const link = container.resolve(ContainerRegistrationKeys.LINK)
        const links: LinkDefinition[] = []

        links.push({
            [PARTNER_MODULE]: {
                partner_id: input.partnerId
            },
            [TASKS_MODULE]: {
                task_id: input.taskId
            },
            data: {
                task_id: input.taskId,
                partner_id: input.partnerId
            }
        })
        await link.create(links)
        return new StepResponse(links)
    },
    async (links: LinkDefinition[], { container }) => {
        const link = container.resolve(ContainerRegistrationKeys.LINK)
        await link.dismiss(links)
    }
)



export const createTaskAssignmentWorkflow = createWorkflow(
    {
        name: "create-task-assignment-with-claim",
        store: true,
    },
    (input: AssignTaskWorkFlowInput) => {
        const validateTask = validateTaskStep(input);
        const partner = validateParnter(input); 
        const assignedTask = linkTaskStep(input);
        return new WorkflowResponse({
            assignedTask,
        });
    }
)



