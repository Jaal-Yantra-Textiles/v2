import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk";
import TaskService from "../../modules/tasks/service";
import { TASKS_MODULE } from "../../modules/tasks";
import { AdminPostDesignTasksReqType } from "../../api/admin/designs/[id]/tasks/validators";
import { Task } from "../../../.medusa/types/query-entry-points";


type CreateTaskStepInput = {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  due_date?: Date;
  assignee_id?: string;
  template_names?: string[];  // Optional template names to create task from
  eventable?: boolean;
  notifiable?: boolean;
  message?: string;
  metadata?: Record<string, any>;
  template_ids?: string[];  // Added for template IDs
  originalInput?: any;      // Added for original input
};

type CreateTaskInput = CreateTaskStepInput;

type CreateTaskWithParentInput = CreateTaskStepInput & {
  parent_task_id?: string;
  child_tasks?: CreateTaskStepInput[];
  dependency_type?: 'blocking' | 'related' | 'subtask';
  template_names?: string[];  // Added for template IDs
  originalInput?: any;      // Added for original input
  child_template_ids?: string []
  template_ids?: string[]
};

type TaskInputAnalysis = {
  hasParentChild: boolean;
  hasTemplates: boolean;
  isParentFromTemplate: boolean;
  hasChildTemplates: boolean;
  parentTaskId?: string;
};


// Step for creating task directly
export const createTaskDirectlyStep = createStep(
  "create-task-directly-step",
  async (input: CreateTaskInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    const task = await taskService.createTasks(input);
    return new StepResponse(task, task.id);
  }
);

// Step for creating task with parent-child relationship
export const createTaskWithParentStep = createStep(
  "create-task-with-parent-step",
  async (input: CreateTaskWithParentInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    
    // Create parent task
    const { template_ids, originalInput } = input;
    const { child_tasks, dependency_type, ...parentData } = originalInput;

    let parentTask;
    if (template_ids && template_ids.length > 0) {
      parentTask = await taskService.createTaskWithTemplates({
        ...parentData,
        template_ids
      });
    } else {
      parentTask = await taskService.createTasks(parentData);
    }

    // Create child tasks if any
    const childTasks: Task[] = [];
    if (input.originalInput.child_tasks && input.originalInput.child_tasks.length > 0) {
      await Promise.all(input.originalInput.child_tasks.map(async (childTask: any, index: number) => {
        const childTaskData = {
          ...childTask,
          title: childTask.title || `Child Task ${childTasks.length + 1}`,
          start_date: childTask.start_date || new Date(),
          status: childTask.status || "pending",
          priority: childTask.priority || parentTask[0].priority || "medium",
          parent_task: parentTask[0].id,
          dependency_type: input.originalInput.dependency_type
        };

        // Use template if available for this child task
        if (input.child_template_ids && input.child_template_ids[index]) {
          const child = await taskService.createTaskWithTemplates({
            ...childTaskData,
            template_ids: input.child_template_ids[index]
          });
          childTasks.push(child);
        } else {
          const child = await taskService.createTasks(childTaskData);
          childTasks.push(child);
        }
      }));
    }

    return new StepResponse({
      parent: parentTask,
      children: childTasks
    });
  }
);

// Step to get template IDs from template names
export const getTemplateIdsStep = createStep(
  "get-template-ids-step",
  async (input: any, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    let templateIds: string[] = [];
    let childTemplateIds:  string[]  = []

    // Get template IDs for parent task
    if (input.template_names && input.template_names.length > 0) {
      const templates = await taskService.listTaskTemplates({
        name: input.template_names
      });
      templateIds = templates.map(template => template.id);
    }

    // Get template IDs for child tasks
    if (input.child_tasks && input.child_tasks.length > 0) {
      await Promise.all(input.child_tasks.map(async (childTask: any) => {
        if (childTask.template_names && childTask.template_names.length > 0) {
          const childTemplates = await taskService.listTaskTemplates({
            name: childTask.template_names
          });
          childTemplateIds = childTemplates.map(template => template.id);
        }
      }));
    }

    const final = {templateIds, childTemplateIds}
    return new StepResponse(
      final
    );
  }
);

// Step for creating task with templates
export const createTaskWithTemplatesStep = createStep(
  "create-task-with-templates-step",
  async (input: CreateTaskInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    const task = await taskService.createTaskWithTemplates(input);
    return new StepResponse(task, task.id);
  }
);

// Step to analyze input and determine next steps
export const figureOutInputForNextStep = createStep(
  "figure-out-input-for-next-step",
  async (input: CreateTaskInput | CreateTaskWithParentInput) => {
    const analysis: TaskInputAnalysis = {
      hasParentChild: false,
      hasTemplates: false,
      isParentFromTemplate: false,
      hasChildTemplates: false,
      parentTaskId: undefined
    };

    // Check for parent-child relationship
    if ('parent_task_id' in input || 'child_tasks' in input) {
      analysis.hasParentChild = true;
      
      if ('parent_task_id' in input) {
        analysis.parentTaskId = input.parent_task_id;
      }
    }

    // Check for templates in main input
    if ('template_names' in input && Array.isArray(input.template_names)) {
      analysis.hasTemplates = true;
      if (analysis.hasParentChild) {
        analysis.isParentFromTemplate = true;
      }
    }

    // Check for templates in child tasks
    if (analysis.hasParentChild && 'child_tasks' in input && Array.isArray(input.child_tasks)) {
      for (const childTask of input.child_tasks) {
        if ('template_names' in childTask && Array.isArray(childTask.template_names)) {
          analysis.hasChildTemplates = true;
          break;
        }
      }
    }
    
    return new StepResponse(analysis);
  }
);

// Export the workflow
export const createTaskWorkflow = createWorkflow(
  "create-task",
  (input: CreateTaskInput | CreateTaskWithParentInput) => {
    // First, analyze the input

    const analysis = figureOutInputForNextStep(input);

    // Transform the analysis result
    const analysisResult = transform(
      { analysis },
      (data) => data.analysis
    );

    // Get template IDs when templates are present
    const templateIdsStep = when(
      "with-templates-get-id",
      analysisResult,
      (result) => result.hasTemplates || result.isParentFromTemplate
    ).then(() => {
      const out = getTemplateIdsStep(input);
      return out
    });


    // Transform input with template IDs
    const inputWithTemplateIds = transform(
      { templateIds: templateIdsStep },
      (data) => (
        
        {
        ...input,
        template_ids: data.templateIds,
        child_template_ids: data.templateIds
      })
    );

    // When task has parent-child relationship (with or without templates)
    const withParent = when(
      "with-parent-condition",
      analysisResult,
      (result) => result.hasParentChild
    ).then(() => {
      //inputWithTemplateIds
      return createTaskWithParentStep({
        originalInput: input,
        template_ids: inputWithTemplateIds.template_ids?.templateIds,
        child_template_ids: inputWithTemplateIds.child_template_ids?.childTemplateIds
      });
    });

    // When single task with templates
    const withTemplates = when(
      "with-templates-without-parent-conditions",
      analysisResult,
      (result) => !result.hasParentChild && result.hasTemplates
    ).then(() => {
      return createTaskWithTemplatesStep({
        originalInput: input,
        template_ids: inputWithTemplateIds.template_ids?.templateIds
      });
    });

    // When single task without templates
    const withoutTemplates = when(
      "without-templates-condition",
      analysisResult,
      (result) => !result.hasParentChild && !result.hasTemplates
    ).then(() => {
      return createTaskDirectlyStep(input);
    });
    
    return new WorkflowResponse({
      withParent,
      withTemplates,
      withoutTemplates,
    });
  }
);
