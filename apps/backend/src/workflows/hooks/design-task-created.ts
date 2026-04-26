import { StepResponse } from "@medusajs/framework/workflows-sdk";
import { createTasksFromTemplatesWorkflow } from "../designs/create-tasks-from-templates";
import { updateDesignWorkflow } from "../designs/update-design";

/**
 * Hook that listens for task creation events and updates the design status
 * from "Conceptual" to "In_Development" when tasks are created
 */
createTasksFromTemplatesWorkflow.hooks.designTaskCreated(
  async ({ designId, tasks }, { container }) => {
    // Only proceed if we have tasks and a valid designId
    if (!tasks || !tasks.length || !designId) {
      return new StepResponse();
    }

    try {
      // Get the workflow instance
      const workflow = updateDesignWorkflow(container);
      
      // Run the workflow to update the design status
      await workflow.run({
        input: {
          id: designId,
          status: "In_Development"
        },
      });
      
      return new StepResponse({ success: true, designId, updatedStatus: "In_Development" });
    } catch (error) {
      console.error("Failed to update design status:", error);
      return new StepResponse({ success: false, error: error.message });
    }
  })