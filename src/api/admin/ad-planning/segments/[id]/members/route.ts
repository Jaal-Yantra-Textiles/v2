/**
 * Segment Members API
 * List members of a segment
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { MedusaError } from "@medusajs/framework/utils";
import { AD_PLANNING_MODULE } from "../../../../../../modules/ad-planning";
import { PERSON_MODULE } from "../../../../../../modules/person";

const ListMembersQuerySchema = z.object({
  limit: z.coerce.number().default(50),
  offset: z.coerce.number().default(0),
});

/**
 * List segment members
 * @route GET /admin/ad-planning/segments/:id/members
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const params = ListMembersQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);
  const personService = req.scope.resolve(PERSON_MODULE);

  // Check segment exists
  const [segment] = await adPlanningService.listCustomerSegments({ id });
  if (!segment) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Segment ${id} not found`);
  }

  // Get segment members
  const members = await adPlanningService.listSegmentMembers(
    { segment_id: id },
    {
      skip: params.offset,
      take: params.limit,
      order: { added_at: "DESC" },
    }
  );

  // Get person details for each member
  const personIds = members.map((m: any) => m.person_id);
  const persons = personIds.length > 0
    ? await (personService as any).listPeople({ id: { $in: personIds } })
    : [];

  const personMap = new Map(persons.map((p: any) => [p.id, p]));

  // Enrich members with person data
  const enrichedMembers = members.map((member: any) => {
    const person = personMap.get(member.person_id) as any;
    return {
      ...member,
      person: person
        ? {
            id: person.id,
            email: person.email,
            first_name: person.first_name,
            last_name: person.last_name,
            phone: person.phone,
          }
        : null,
    };
  });

  res.json({
    segment: {
      id: segment.id,
      name: segment.name,
      customer_count: segment.customer_count,
    },
    members: enrichedMembers,
    count: members.length,
    offset: params.offset,
    limit: params.limit,
  });
};
