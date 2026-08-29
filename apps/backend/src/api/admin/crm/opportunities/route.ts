import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { CRM_MODULE } from "../../../../modules/crm";
import { createOpportunityWorkflow } from "../../../../workflows/crm/create-opportunity";
import { OPPORTUNITY_LIST_FILTER_FIELDS } from "./validators";

/**
 * Open a deal (#1552).
 *
 * 🔴 Goes through the WORKFLOW, not straight to the service. `createOpportunity
 * Workflow` had zero callers anywhere in `src/` while this route wrote directly
 * — dead code beside a second writer. One path means one place to hang the side
 * effects a deal deserves (an activity record, moving the originating lead to
 * `qualified`) and one compensation if any of them fails.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await createOpportunityWorkflow(req.scope).run({
    input: req.validatedBody as any,
  });
  res.status(201).json({ crm_opportunity: result });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const q = req.query as Record<string, string | undefined>;
  const filters: Record<string, string> = {};
  for (const f of OPPORTUNITY_LIST_FILTER_FIELDS) {
    if (q[f] !== undefined && q[f] !== "") filters[f] = q[f] as string;
  }
  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const [crm_opportunities, count] = await service.listAndCountCrmOpportunities(
    filters,
    { take: limit, skip: offset }
  );
  res.json({ crm_opportunities, count, limit, offset });
};
