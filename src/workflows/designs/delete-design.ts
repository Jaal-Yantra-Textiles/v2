import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import DesignService from "../../modules/designs/service";
import { DESIGN_MODULE } from "../../modules/designs";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

type DeleteDesignStepInput = {
  id: string;
};

const dismissDesignLinksStep = createStep(
  "dismiss-design-links-step",
  async (input: DeleteDesignStepInput, { container }) => {
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK);
    await remoteLink.dismiss({
      [DESIGN_MODULE]: { design_id: input.id },
    });
    return new StepResponse(undefined);
  }
);

export const deleteDesignStep = createStep(
  "delete-design-step",
  async (input: DeleteDesignStepInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    // Store the design data for compensation
    const design = await designService.retrieveDesign(input.id);
    await designService.deleteDesigns(input.id);
    return new StepResponse({ id: input.id }, { originalData: design });
  },
  // Compensation function to restore deleted design
  async (data: { originalData: any }, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    await designService.createDesigns(data.originalData);
  }
);

type DeleteDesignWorkFlowInput = {
  id: string;
};

export const deleteDesignWorkflow = createWorkflow(
  "delete-design",
  (input: DeleteDesignWorkFlowInput) => {
    dismissDesignLinksStep(input);
    const result = deleteDesignStep(input);
    return new WorkflowResponse(result);
  },
);

export default deleteDesignWorkflow;
