import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import TaskService from "../../modules/tasks/service";
import { TASKS_MODULE } from "../..//modules/tasks";

type DeleteTaskStepInput = {
  id: string;
};

export const deleteTaskStep = createStep(
  "delete-task-step",
  async (input: DeleteTaskStepInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    await taskService.deleteTasks(input.id);
    return new StepResponse({ success: true });
  }
);

type DeleteTaskWorkflowInput = DeleteTaskStepInput;

export const deleteTaskWorkflow = createWorkflow(
  "delete-task",
  (input: DeleteTaskWorkflowInput) => {
    const result = deleteTaskStep(input);
    return new WorkflowResponse(result);
  }
);
