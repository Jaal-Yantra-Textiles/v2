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
  fields: string[];
};

export const listSingleDesignStep = createStep(
  "list-single-design-step",
  async (input: ListDesignsStepInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    const designFromServices = await designService.retrieveDesign(input.id, {
      relations: ["colors", "size_sets", "specifications"],
    });

    const fields = Array.from(new Set([...(input.fields || []), "*"]));

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data: design } = await query.graph({
      entity: "designs",
      fields: fields.length ? fields : ["*"],
      filters: {
        id: input.id,
      },
    });

    const graphDesign = design?.[0];

    if (!graphDesign && !designFromServices) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Design with id ${input.id} was not found`,
      );
    }

    const mergedDesign = {
      ...designFromServices,
      ...graphDesign,
      colors: graphDesign?.colors ?? designFromServices?.colors,
      size_sets: graphDesign?.size_sets ?? designFromServices?.size_sets,
      specifications: graphDesign?.specifications ?? designFromServices?.specifications,
    };

    return new StepResponse(mergedDesign, mergedDesign?.id);
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