import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import DesignService from "../../modules/designs/service";
import { DESIGN_MODULE } from "../../modules/designs";

type DeleteDesignStepInput = {
  id: string;
};

export const deleteDesignStep = createStep(
  "delete-design-step",
  async (input: DeleteDesignStepInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    await designService.softDeleteDesigns(input.id);
    return new StepResponse({ id: input.id }, { id: input.id });
  },
  async (data: { id: string } | undefined, { container }) => {
    if (!data?.id) return;
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    await designService.restoreDesigns(data.id);
  }
);

type DeleteDesignWorkFlowInput = {
  id: string;
};

export const deleteDesignWorkflow = createWorkflow(
  "delete-design",
  (input: DeleteDesignWorkFlowInput) => {
    const result = deleteDesignStep(input);
    return new WorkflowResponse(result);
  },
);

export default deleteDesignWorkflow;
