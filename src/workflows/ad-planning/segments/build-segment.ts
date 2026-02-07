/**
 * Build Segment Workflow
 *
 * Evaluates segment criteria and adds/removes members.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AD_PLANNING_MODULE } from "../../../modules/ad-planning";
import type AdPlanningService from "../../../modules/ad-planning/service";
import { PERSON_MODULE } from "../../../modules/person";
import type PersonService from "../../../modules/person/service";

type BuildSegmentInput = {
  segment_id: string;
};

type SegmentCriteria = {
  type: "and" | "or";
  conditions: Array<{
    field: string;
    operator: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "between" | "in" | "not_in";
    value: any;
  }>;
};

/**
 * Step 1: Get segment details
 */
const getSegmentStep = createStep(
  "get-segment",
  async (input: { segment_id: string }, { container }) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    const [segment] = await adPlanningService.listCustomerSegments({ id: input.segment_id });

    if (!segment) {
      throw new Error(`Segment ${input.segment_id} not found`);
    }

    return new StepResponse(segment);
  }
);

/**
 * Step 2: Fetch all potential customers
 */
const fetchCustomersStep = createStep(
  "fetch-customers",
  async (_input: void, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Get all persons
    const persons = await (personService as any).listPeople({});

    // Get customer scores for each person
    const personIds = persons.map((p: any) => p.id);
    const scores = await adPlanningService.listCustomerScores({
      person_id: { $in: personIds },
    });

    // Get conversions for each person
    const conversions = await adPlanningService.listConversions({
      person_id: { $in: personIds },
    });

    // Build enriched customer data
    const customerData = persons.map((person: any) => {
      const personScores = scores.filter((s: any) => s.person_id === person.id);
      const personConversions = conversions.filter((c: any) => c.person_id === person.id);

      return {
        person_id: person.id,
        email: person.email,
        created_at: person.created_at,
        // Scores
        nps_score: personScores.find((s: any) => s.score_type === "nps")?.score_value || null,
        engagement_score: personScores.find((s: any) => s.score_type === "engagement")?.score_value || null,
        clv_score: personScores.find((s: any) => s.score_type === "clv")?.score_value || null,
        churn_risk: personScores.find((s: any) => s.score_type === "churn_risk")?.score_value || null,
        // Conversion metrics
        total_purchases: personConversions.filter((c: any) => c.conversion_type === "purchase").length,
        total_revenue: personConversions
          .filter((c: any) => c.conversion_type === "purchase")
          .reduce((sum: number, c: any) => sum + (Number(c.conversion_value) || 0), 0),
        last_purchase_date: personConversions
          .filter((c: any) => c.conversion_type === "purchase")
          .sort((a: any, b: any) => new Date(b.converted_at).getTime() - new Date(a.converted_at).getTime())[0]
          ?.converted_at || null,
        total_conversions: personConversions.length,
        // Tags and metadata from person
        tags: person.tags?.map((t: any) => t.name || t.value) || [],
        metadata: person.metadata || {},
      };
    });

    return new StepResponse(customerData);
  }
);

/**
 * Step 3: Evaluate criteria for each customer
 */
const evaluateCriteriaStep = createStep(
  "evaluate-criteria",
  async (
    input: {
      customers: Array<Record<string, any>>;
      criteria: SegmentCriteria;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    const matchingCustomers: string[] = [];

    for (const customer of input.customers) {
      // Convert criteria format to service expected format
      const serviceCriteria = {
        rules: (input.criteria as any).conditions?.map((c: any) => ({
          field: c.field,
          operator: c.operator === "equals" ? "==" :
                   c.operator === "not_equals" ? "!=" :
                   c.operator === "greater_than" ? ">" :
                   c.operator === "less_than" ? "<" :
                   c.operator,
          value: c.value,
        })) || [],
        logic: ((input.criteria as any).type?.toUpperCase() || "AND") as "AND" | "OR",
      };

      const matches = adPlanningService.evaluateSegmentCriteria(
        serviceCriteria,
        customer
      );

      if (matches) {
        matchingCustomers.push(customer.person_id);
      }
    }

    return new StepResponse({
      matching_ids: matchingCustomers,
      total_evaluated: input.customers.length,
    });
  }
);

/**
 * Step 4: Update segment members
 */
const updateMembersStep = createStep(
  "update-members",
  async (
    input: {
      segment_id: string;
      matching_person_ids: string[];
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Get current members
    const currentMembers = await adPlanningService.listSegmentMembers({
      segment_id: input.segment_id,
    });
    const currentMemberIds = new Set(currentMembers.map((m: any) => m.person_id));

    // Determine adds and removes
    const newMemberIds = new Set(input.matching_person_ids);
    const toAdd = input.matching_person_ids.filter(id => !currentMemberIds.has(id));
    const toRemove = currentMembers
      .filter((m: any) => !newMemberIds.has(m.person_id))
      .map((m: any) => m.id);

    // Add new members
    if (toAdd.length > 0) {
      await adPlanningService.createSegmentMembers(
        toAdd.map(person_id => ({
          segment_id: input.segment_id,
          person_id,
          added_at: new Date(),
        }))
      );
    }

    // Remove old members
    if (toRemove.length > 0) {
      await adPlanningService.deleteSegmentMembers(toRemove);
    }

    return new StepResponse({
      added: toAdd.length,
      removed: toRemove.length,
      total: input.matching_person_ids.length,
    });
  }
);

/**
 * Step 5: Update segment stats
 */
const updateSegmentStatsStep = createStep(
  "update-segment-stats",
  async (
    input: {
      segment_id: string;
      customer_count: number;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    await adPlanningService.updateCustomerSegments([
      {
        selector: { id: input.segment_id },
        data: {
          customer_count: input.customer_count,
          last_calculated_at: new Date(),
        },
      },
    ]);

    return new StepResponse({ updated: true });
  }
);

/**
 * Main workflow: Build segment
 */
export const buildSegmentWorkflow = createWorkflow(
  "build-segment",
  (input: BuildSegmentInput) => {
    const segment = getSegmentStep({ segment_id: input.segment_id });
    const customers = fetchCustomersStep();

    const evaluation = evaluateCriteriaStep({
      customers,
      criteria: segment.criteria as SegmentCriteria,
    });

    const memberUpdate = updateMembersStep({
      segment_id: input.segment_id,
      matching_person_ids: evaluation.matching_ids,
    });

    updateSegmentStatsStep({
      segment_id: input.segment_id,
      customer_count: evaluation.matching_ids.length,
    });

    return new WorkflowResponse({
      segment_id: input.segment_id,
      total_evaluated: evaluation.total_evaluated,
      matching_count: evaluation.matching_ids.length,
      members_added: memberUpdate.added,
      members_removed: memberUpdate.removed,
    });
  }
);

export default buildSegmentWorkflow;
