import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { PERSON_PROPERTY_MODULE } from "../../../modules/personproperty";
import { LIST_FILTER_FIELDS } from "./validators";

/**
 * Admin CRUD for person_property. Goes through the MODULE SERVICE (not
 * query.graph) on purpose: the generated create/list methods delegate to the
 * injected internal service, so with PERSON_PROPERTY_HYPERBEE=true these run over
 * the Hyperbee DAL and with the flag off they run over Postgres — same route,
 * same responses, swappable backend.
 */

// POST /admin/person-properties — create one
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PERSON_PROPERTY_MODULE);
  const created = await service.createPersonProperties(req.validatedBody);
  res.status(201).json({ person_property: created });
};

// GET /admin/person-properties?district=AMBALA&limit=20&offset=0 — list + count
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PERSON_PROPERTY_MODULE);
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  const q = req.query as Record<string, string | undefined>;
  const filters: Record<string, string> = {};
  for (const f of LIST_FILTER_FIELDS) {
    if (q[f] !== undefined && q[f] !== "") filters[f] = q[f] as string;
  }

  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100);
  const offset = Math.max(Number(q.offset) || 0, 0);

  try {
    const [person_properties, count] = await service.listAndCountPersonProperties(
      filters,
      { take: limit, skip: offset }
    );
    res.json({ person_properties, count, limit, offset });
  } catch (e: any) {
    logger?.error(`[person-properties] list failed: ${e?.message || e}`);
    throw e;
  }
};
