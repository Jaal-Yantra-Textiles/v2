import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { RemoteQueryFunction } from "@medusajs/types";
import { DESIGN_MODULE } from "../../modules/designs";
import { DateComparisonOperator } from "@medusajs/types";
import DesignService from "../../modules/designs/service";

export type ListDesignsStepInput = {
  filters?: {
    name?: string;
    design_type?: "Original" | "Derivative" | "Custom" | "Collaboration";
    status?: "Conceptual" | "In_Development" | "Technical_Review" | "Sample_Production" | "Revision" | "Approved" | "Rejected" | "On_Hold";
    priority?: "Low" | "Medium" | "High" | "Urgent";
    tags?: string[];
    partner_id?: string;
    created_at?: DateComparisonOperator;
    target_completion_date?: DateComparisonOperator;
  };
  pagination: {
    offset: number;
    limit: number;
  };
};

export const listDesignsStep = createStep(
  "list-designs-step",
  async (input: ListDesignsStepInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE)
    const query = container.resolve(
      ContainerRegistrationKeys.QUERY
    ) as Omit<RemoteQueryFunction, symbol>

    const {
      partner_id,
      ...restFilters
    } = input.filters || {}

    const normalizeFilters = (filters: typeof restFilters) => {
      const normalized: Record<string, any> = {}
      if (filters?.name && filters.name.trim().length > 0) {
        normalized.name = { $ilike: `%${filters.name.trim()}%` }
      }
      if (filters?.design_type) {
        normalized.design_type = filters.design_type
      }
      if (filters?.status) {
        normalized.status = filters.status
      }
      if (filters?.priority) {
        normalized.priority = filters.priority
      }
      if (filters?.tags?.length) {
        normalized.tags = filters.tags
      }
      const applyDateFilter = (
        field: "created_at" | "target_completion_date",
        comparison?: DateComparisonOperator,
      ) => {
        if (!comparison) {
          return
        }
        const sanitized = Object.entries(comparison).reduce<
          DateComparisonOperator
        >((acc, [key, value]) => {
          if (value) {
            acc[key as keyof DateComparisonOperator] = value
          }
          return acc
        }, {})

        if (Object.keys(sanitized).length) {
          normalized[field] = sanitized
        }
      }

      applyDateFilter("created_at", filters?.created_at)
      applyDateFilter("target_completion_date", filters?.target_completion_date)

      return normalized
    }

    const normalizedFilters = normalizeFilters(restFilters || {})

    // When partner filter is provided, leverage the index module so we can filter across the link
    if (partner_id) {
      const indexFilters = {
        ...normalizedFilters,
        partners: { id: partner_id },
      }

      const { data, metadata } = await query.index({
        entity: "design",
        fields: ["*", "partners.*"],
        filters: indexFilters,
        pagination: {
          skip: input.pagination.offset,
          take: input.pagination.limit,
        },
      })

      const designs = data || []
      const count =
        (metadata as any)?.count ??
        designs.length

      return new StepResponse(
        {
          designs,
          count,
          offset: input.pagination.offset,
          limit: input.pagination.limit,
        },
        null
      )
    }

    const [designs, count] = await designService.listAndCountDesigns(
      normalizedFilters,
      {
        skip: input.pagination.offset,
        take: input.pagination.limit,
      }
    )

    return new StepResponse(
      {
        designs,
        count,
        offset: input.pagination.offset,
        limit: input.pagination.limit,
      },
      null
    )
  },
);

export type ListDesignsWorkFlowInput = ListDesignsStepInput;

export const listDesignsWorkflow = createWorkflow(
  {
    name:'list-designs',
    store: true,
  },
  (input: ListDesignsWorkFlowInput) => {
    const result = listDesignsStep(input);
    return new WorkflowResponse(result);
  },
);

export default listDesignsWorkflow;
