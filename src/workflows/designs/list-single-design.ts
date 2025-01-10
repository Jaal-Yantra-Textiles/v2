import {
    createStep,
    createWorkflow,
    StepResponse,
    WorkflowResponse,
  } from "@medusajs/framework/workflows-sdk";
  import { DESIGN_MODULE } from "../../modules/designs";
  import DesignService from "../../modules/designs/service";
  
  export type ListDesignsStepInput = {
    id: string
  };
  
  export const listSingleDesignStep = createStep(
    "list-single-design-step",
    async (input: ListDesignsStepInput, { container }) => {
      const designService: DesignService = container.resolve(DESIGN_MODULE);
        
      const design = await designService.retrieveDesign(
        input.id
      );
  
      return new StepResponse(design, design.id);
    },
  );
  
  export type ListDesignsWorkFlowInput = ListDesignsStepInput;
  
  export const listSingleDesignsWorkflow = createWorkflow(
    "list-single-design",
    (input: ListDesignsWorkFlowInput) => {
      const result = listSingleDesignStep(input);
      return new WorkflowResponse(result);
    },
  );
  
  export default listSingleDesignsWorkflow;
  