import {
    createStep,
    createWorkflow,
    StepResponse,
    WorkflowResponse,
  } from "@medusajs/framework/workflows-sdk";
  import { DESIGN_MODULE } from "../../modules/designs";
  import DesignService from "../../modules/designs/service";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
  
  export type ListDesignsStepInput = {
    id: string
  };
  
  export const listSingleDesignStep = createStep(
    "list-single-design-step",
    async (input: ListDesignsStepInput, { container }) => {
      const designService: DesignService = container.resolve(DESIGN_MODULE);
      
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const {data: design} = await query.graph({
        entity: 'designs',
        fields: ['*', "tasks.*"],
        filters: {
          id: input.id
        }
      })
      return new StepResponse(design[0], design[0]?.id);
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
  