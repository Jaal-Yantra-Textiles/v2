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
import { Modules } from "@medusajs/framework/utils";
import { AD_PLANNING_MODULE } from "../../../modules/ad-planning";
import type AdPlanningService from "../../../modules/ad-planning/service";
import { PERSON_MODULE } from "../../../modules/person";
import type PersonService from "../../../modules/person/service";

type BuildSegmentInput = {
  segment_id: string;
};

/** Unified criteria format stored in DB and used throughout the system */
type SegmentRule = {
  field: string;
  operator: string;
  value: any;
};

type SegmentCriteria = {
  logic: "AND" | "OR" | "NOT";
  rules?: SegmentRule[];
  groups?: SegmentCriteria[];
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
 * Step 2: Fetch all potential customers with full demographic + behavioral enrichment
 */
const fetchCustomersStep = createStep(
  "fetch-customers",
  async (_input: void, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // --- Person data ---
    const persons = await (personService as any).listPeople({});
    const personIds = persons.map((p: any) => p.id);

    // --- Scores + conversions ---
    const scores = await adPlanningService.listCustomerScores({
      person_id: { $in: personIds },
    });
    const conversions = await adPlanningService.listConversions({
      person_id: { $in: personIds },
    });

    // --- Person addresses (demographic: country, city, state) ---
    const addresses = personIds.length > 0
      ? await (personService as any).listPersonAddresses({ person_id: { $in: personIds } }).catch(() => [])
      : [];
    const addressByPerson = new Map<string, any>();
    for (const addr of addresses) {
      // Use first address per person
      if (!addressByPerson.has(addr.person_id)) {
        addressByPerson.set(addr.person_id, addr);
      }
    }

    // --- Medusa Customer data (match by email) ---
    const emails = persons.map((p: any) => p.email).filter(Boolean);
    let medusaCustomerMap = new Map<string, any>(); // keyed by email
    let orderCountByCustomerId = new Map<string, number>();

    if (emails.length > 0) {
      try {
        const customerModule = container.resolve(Modules.CUSTOMER);
        const medusaCustomers: any[] = await (customerModule as any).listCustomers(
          { email: { $in: emails } },
          { select: ["id", "email", "has_account", "created_at"] }
        );
        for (const c of medusaCustomers) {
          medusaCustomerMap.set(c.email, c);
        }

        // Order counts for matched customers
        const customerIds = medusaCustomers.map((c: any) => c.id);
        if (customerIds.length > 0) {
          const orderModule = container.resolve(Modules.ORDER);
          const orders: any[] = await (orderModule as any).listOrders(
            { customer_id: { $in: customerIds } },
            { select: ["customer_id"] }
          );
          for (const order of orders) {
            orderCountByCustomerId.set(
              order.customer_id,
              (orderCountByCustomerId.get(order.customer_id) || 0) + 1
            );
          }
        }
      } catch {
        // Customer / Order module might not have data — non-fatal
      }
    }

    const now = new Date();

    // --- Build enriched customer data ---
    const customerData = persons.map((person: any) => {
      const personScores = scores.filter((s: any) => s.person_id === person.id);
      const personConversions = conversions.filter((c: any) => c.conversion_type === "purchase"
        ? c.person_id === person.id
        : c.person_id === person.id);
      const purchases = personConversions.filter((c: any) => c.conversion_type === "purchase");
      const addr = addressByPerson.get(person.id);
      const medusaCustomer = medusaCustomerMap.get(person.email);

      // Compute age from date_of_birth
      let age: number | null = null;
      if (person.date_of_birth) {
        const dob = new Date(person.date_of_birth);
        age = Math.floor((now.getTime() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
      }

      // Compute customer_since_days
      let customer_since_days: number | null = null;
      if (medusaCustomer?.created_at) {
        const createdAt = new Date(medusaCustomer.created_at);
        customer_since_days = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
      }

      return {
        person_id: person.id,
        email: person.email,
        created_at: person.created_at,

        // Behavioral scores
        nps_score: personScores.find((s: any) => s.score_type === "nps")?.score_value ?? null,
        engagement_score: personScores.find((s: any) => s.score_type === "engagement")?.score_value ?? null,
        clv_score: personScores.find((s: any) => s.score_type === "clv")?.score_value ?? null,
        churn_risk: personScores.find((s: any) => s.score_type === "churn_risk")?.score_value ?? null,

        // Purchase / conversion metrics
        total_purchases: purchases.length,
        total_revenue: purchases.reduce((sum: number, c: any) => sum + (Number(c.conversion_value) || 0), 0),
        last_purchase_date: purchases.sort(
          (a: any, b: any) => new Date(b.converted_at).getTime() - new Date(a.converted_at).getTime()
        )[0]?.converted_at ?? null,
        total_conversions: personConversions.length,

        // Demographic — from Person
        date_of_birth: person.date_of_birth ?? null,
        age,
        country: addr?.country ?? null,
        city: addr?.city ?? null,
        state: addr?.state ?? null,

        // Tags and metadata from person
        tags: person.tags?.map((t: any) => t.name || t.value) || [],
        metadata: person.metadata || {},
        person_state: person.state ?? null,

        // Medusa Customer fields
        has_account: medusaCustomer?.has_account ?? false,
        customer_since_days,
        customer_created_at: medusaCustomer?.created_at ?? null,
        customer_order_count: medusaCustomer
          ? (orderCountByCustomerId.get(medusaCustomer.id) ?? 0)
          : 0,
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
      // Normalize: handle legacy flat format { rules, logic } stored before schema update
      const criteria = input.criteria as any;
      const normalized: SegmentCriteria = criteria.logic && (criteria.rules || criteria.groups)
        ? criteria
        : {
            logic: (criteria.type?.toUpperCase() || "AND") as "AND",
            rules: (criteria.conditions || criteria.rules || []).map((c: any) => ({
              field: c.field,
              operator: c.operator === "equals" ? "==" :
                       c.operator === "not_equals" ? "!=" :
                       c.operator === "greater_than" ? ">" :
                       c.operator === "less_than" ? "<" :
                       c.operator,
              value: c.value,
            })),
          };

      if (adPlanningService.evaluateSegmentCriteria(normalized, customer)) {
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

    // Determine adds and removes — preserve manually added members
    const newMemberIds = new Set(input.matching_person_ids);
    const toAdd = input.matching_person_ids.filter(id => !currentMemberIds.has(id));
    const toRemove = currentMembers
      .filter((m: any) => !newMemberIds.has(m.person_id) && m.added_reason === "rule_match")
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
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Count actual members after add/remove for accuracy
    const members = await adPlanningService.listSegmentMembers({
      segment_id: input.segment_id,
    });

    await adPlanningService.updateCustomerSegments([
      {
        selector: { id: input.segment_id },
        data: {
          customer_count: members.length,
          last_calculated_at: new Date(),
        },
      },
    ]);

    return new StepResponse({ updated: true, customer_count: members.length });
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
