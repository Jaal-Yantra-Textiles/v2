import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import { CRM_MODULE } from "../../modules/crm";

type CreateTaskStepInput = {
  title: string;
  description?: string | null;
  due_date?: string | null;
  status?: string;
  priority?: string;
  assignee_person_id?: string | null;
  related_type?: string | null;
  related_id?: string | null;
  metadata?: Record<string, any>;
};

export const createTaskStep = createStep(
  "create-crm-task-step",
  async (input: CreateTaskStepInput, { container }) => {
    const service: any = container.resolve(CRM_MODULE);
    const task = await service.createCrmTasks(input);
    return new StepResponse(task, task.id);
  },
  async (taskId, { container }) => {
    const service: any = container.resolve(CRM_MODULE);
    await service.deleteCrmTasks(taskId!);
  },
);

export type CreateTaskWorkflowInput = CreateTaskStepInput;

export const createTaskWorkflow = createWorkflow(
  "create-crm-task",
  (input: CreateTaskWorkflowInput) => {
    const task = createTaskStep(input);
    return new WorkflowResponse(task);
  },
);

export default createTaskWorkflow;
