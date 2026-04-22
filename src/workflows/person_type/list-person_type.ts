// src/workflows/list-person-types.ts
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { PERSON_TYPE_MODULE } from "../../modules/persontype";
import PersonTypeService from "../../modules/persontype/service";

export type ListPersonTypesStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
    order?: Record<string, "ASC" | "DESC">;
  };
};

export const listPersonTypesStep = createStep(
  "list-person-types-step",
  async (input: ListPersonTypesStepInput, { container }) => {
    const personTypeService: PersonTypeService =
      container.resolve(PERSON_TYPE_MODULE);

    // Default newest-first — overridable via config.order.
    const config = {
      ...(input.config || {}),
      order: input.config?.order ?? { created_at: "DESC" },
    };

    const personTypes = await personTypeService.listAndCountPersonTypes(
      input.filters,
      config as any,
    );

    return new StepResponse(personTypes, null);
  },
);

export type ListPersonTypesWorkFlowInput = {
  filters?: Record<string, any>;
  pagination: {
    offset: number;
    limit: number;
  };
  order?: Record<string, "ASC" | "DESC">;
};

export const listPersonTypeWorkflow = createWorkflow(
  "list-person-type",
  (input: ListPersonTypesWorkFlowInput) => {
    // Forward pagination + caller-supplied sort into the step's config so
    // skip/take/order all reach the service. (The legacy step signature only
    // threaded `filters`, which silently ignored limit/offset.)
    const listPersonType = listPersonTypesStep({
      filters: input.filters,
      config: {
        skip: input.pagination?.offset ?? 0,
        take: input.pagination?.limit ?? 20,
        order: input.order,
      },
    });

    return new WorkflowResponse(listPersonType);
  },
);
