import {
    createStep,
    createWorkflow,
    StepResponse,
    WorkflowResponse,
  } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import type { RemoteQueryFunction } from "@medusajs/types";
  
  export type ListPersonStepInput = {
    id: string;
    fields: string[]
  };
  
  export const listSinglePersonStep = createStep(
    "list-single-person-step",
    async (input: ListPersonStepInput, { container }) => {;
      input.fields.push('*')
      input.fields.push('person_types.*')
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
      const {data: person} = await query.graph({
        entity: 'person',
        fields: input.fields || ['*'],
        filters: {
          id: input.id
        }
      })
     
      if (!person[0]) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Person with id ${input.id} was not found`
        )
      }
      return new StepResponse(person[0]);
    },
  );
  
  export type ListPersonWorkFlowInput = ListPersonStepInput;
  
  export const listSinglePersonWorkflow = createWorkflow(
   {
    name: 'list-single-workflow',
    store: true,
   },
    (input: ListPersonWorkFlowInput) => {
      const result = listSinglePersonStep(input);
      return new WorkflowResponse(result);
    },
  );
  
  export default listSinglePersonWorkflow;
  