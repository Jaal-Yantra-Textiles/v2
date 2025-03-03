import {
    createStep,
    createWorkflow,
    StepResponse,
    WorkflowResponse,
  } from "@medusajs/framework/workflows-sdk";
  import { DESIGN_MODULE } from "../../modules/designs";
  import DesignService from "../../modules/designs/service";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
  
  export type ListDesignsStepInput = {
    id: string;
    fields: string[]
  };
  
  export const listSingleDesignStep = createStep(
    "list-single-design-step",
    async (input: ListDesignsStepInput, { container }) => {
      const designService: DesignService = container.resolve(DESIGN_MODULE);
      input.fields.push('*')
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const {data: design} = await query.graph({
        entity: 'designs',
        fields: input.fields || ['*'],
        filters: {
          id: input.id
        }
      })
      if (!design[0]) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Design with id ${input.id} was not found`
        )
      }
      console.log("Design at the workflow",design[0])
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
  