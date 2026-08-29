import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { CRM_MODULE } from "../../../../modules/crm";
import { COMPANY_LIST_FILTER_FIELDS } from "./validators";
import {
  CRM_ORDERABLE_FIELDS,
  parseListOrder,
} from "../../../../modules/crm/dal/list-order";

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const created = await service.createCrmCompanies(req.validatedBody);
  res.status(201).json({ crm_company: created });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const q = req.query as Record<string, string | undefined>;
  const filters: Record<string, string> = {};
  for (const f of COMPANY_LIST_FILTER_FIELDS) {
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
  const [crm_companies, count] = await service.listAndCountCrmCompanies(
    filters,
    { take: limit, skip: offset, ...(order ? { order } : {}) }
  );
  res.json({ crm_companies, count, limit, offset });
};
