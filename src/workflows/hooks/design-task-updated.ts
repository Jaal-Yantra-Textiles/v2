import { StepResponse } from "@medusajs/framework/workflows-sdk";
import { updateDesignTaskWorkflow } from "../designs/update-design-task";
import { updateDesignWorkflow } from "../designs/update-design";
import { TASKS_MODULE } from "../../modules/tasks";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { InferTypeOf } from "@medusajs/framework/types"
import TaskModel from "../../modules/tasks/models/task";

// Use the inferred type from the Task model
export type Task = InferTypeOf<typeof TaskModel>
/**
 * Hook that listens for task update events and potentially updates the design status
 * based on the collective status of all tasks
 */
updateDesignTaskWorkflow.hooks.designTaskUpdated(
  async ({ taskID, designId, update }, { container }) => {
    if (!taskID || !designId) {
      return new StepResponse();
    }

    try {
      // Get the task service to fetch all tasks for this design
      const taskService = container.resolve(TASKS_MODULE);
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      // Get all tasks for this design
      // const tasks = await taskService.listTasks({
      //   id: taskID,
      // });

      const { data } = await query.graph({
        entity: 'design',
        filters: {
          id: designId
        },
        fields: ['tasks.*', 'tasks.incoming.*', 'tasks.outgoing.*']
      })

      if (!data || !data.length || !data[0].tasks) {
        return new StepResponse({ success: false, error: "No tasks found" });
      }
      
      // Extract tasks from the response
      const designTasks = data[0].tasks;
      
      if (!designTasks.length) {
        return new StepResponse({ success: false, error: "No tasks found for design" });
      }
      
      // Safely cast tasks to the correct type
      const typedTasks = designTasks as unknown as Task[];
      
      // Analyze dependencies
      const dependencyInfo = typedTasks.map(task => {
        return {
          id: task.id,
          status: task.status || "pending",
          hasBlockingDependencies: task.incoming?.some(dep => dep.dependency_type === "blocking") || false,
          hasBlockedTasks: task.outgoing?.some(dep => dep.dependency_type === "blocking") || false
        };
      });
      
      // Check if any tasks are blocked by dependencies
      const blockedTasks = dependencyInfo.filter(task => 
        task.hasBlockingDependencies && 
        dependencyInfo.some(dep => 
          dep.hasBlockedTasks && 
          dep.status !== "completed"
        )
      );
      
      // Count tasks by status
      const statusCounts = typedTasks.reduce<Record<string, number>>((acc, task) => {
        const status = task.status || "pending";
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});
      
      // Define the design status type
      type DesignStatus = "Conceptual" | "In_Development" | "Technical_Review" | "Sample_Production" | "Revision" | "Approved" | "Rejected" | "On_Hold";
      
      // Determine if we need to update the design status
      let newDesignStatus: DesignStatus | null = null;
      
      // If all tasks are completed, set design to Technical_Review
      if (statusCounts.completed === typedTasks.length) {
        newDesignStatus = "Technical_Review";
      } 
      // If more than half of tasks are in_progress, keep as In_Development
      else if ((statusCounts.in_progress || 0) > typedTasks.length / 2) {
        newDesignStatus = "In_Development";
      }
      
      // If we need to update the design status
      if (newDesignStatus) {
        // Get the workflow instance
        const workflow = updateDesignWorkflow(container);
        
        // Run the workflow to update the design status
        await workflow.run({
          input: {
            id: designId,
            status: newDesignStatus
          },
        });
        
        return new StepResponse({ 
          success: true, 
          designId, 
          updatedStatus: newDesignStatus,
          taskStatusCounts: statusCounts
        });
      }
      
      return new StepResponse({ 
        success: true, 
        designId,
        noStatusChange: true,
        taskStatusCounts: statusCounts
      });
    } catch (error) {
      console.error("Failed to update design status based on task updates:", error);
      return new StepResponse({ success: false, error: error.message });
    }
  }
);
