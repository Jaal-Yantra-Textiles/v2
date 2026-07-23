import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { CRM_MODULE } from "../../../../modules/crm";
import { PERSON_LIST_FILTER_FIELDS } from "./validators";

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const created = await service.createCrmPeople(req.validatedBody);
  res.status(201).json({ crm_person: created });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(CRM_MODULE);
  const q = req.query as Record<string, string | undefined>;
  const filters: Record<string, string> = {};
  for (const f of PERSON_LIST_FILTER_FIELDS) {
    if (q[f] !== undefined && q[f] !== "") filters[f] = q[f] as string;
  }
  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const [crm_people, count] = await service.listAndCountCrmPeople(filters, {
    take: limit,
    skip: offset,
  });
  res.json({ crm_people, count, limit, offset });
};
