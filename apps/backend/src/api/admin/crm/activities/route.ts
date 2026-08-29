import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { CRM_MODULE } from "../../../../modules/crm";
import { ACTIVITY_LIST_FILTER_FIELDS } from "./validators";
import {
  CRM_ORDERABLE_FIELDS,
  parseListOrder,
} from "../../../../modules/crm/dal/list-order";

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  // `recordCrmActivity`, not `createCrmActivities`: writing the row without
  // refreshing the contact's engagement cache would leave `engagement_state`
  // describing a conversation that has moved on — and flows select on it.
  const created = await service.recordCrmActivity(req.validatedBody);
  res.status(201).json({ crm_activity: created });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const q = req.query as Record<string, string | undefined>;
  const filters: Record<string, string> = {};
  for (const f of ACTIVITY_LIST_FILTER_FIELDS) {
    if (q[f] !== undefined && q[f] !== "") filters[f] = q[f] as string;
  }
  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100);
  const offset = Math.max(Number(q.offset) || 0, 0);
  /**
   * Sorting (#1551). Allowlisted to real columns — the field reaches a
   * repository query verbatim. An unrecognised value orders by nothing rather
   * than erroring: a list that ignores a bad sort is better than a 400 on a
   * page load.
   */
  const order = parseListOrder(q.order, CRM_ORDERABLE_FIELDS);
  const [rows, count] = await service.listAndCountCrmActivities(filters, {
    take: limit,
    skip: offset,
    ...(order ? { order } : {}),
  });

  // Newest first. The store has no ordering guarantee and a timeline read in
  // arbitrary order is not a timeline.
  const crm_activities = [...rows].sort(
    (a: any, b: any) =>
      Date.parse(b?.occurred_at ?? 0) - Date.parse(a?.occurred_at ?? 0)
  );

  res.json({ crm_activities, count, limit, offset });
};
