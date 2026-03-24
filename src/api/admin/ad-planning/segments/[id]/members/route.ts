/**
 * Segment Members API
 * List members of a segment
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { MedusaError, Modules } from "@medusajs/framework/utils";
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
  const [members, totalCount] = await adPlanningService.listAndCountSegmentMembers(
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

  // Resolve Medusa Customers by email for account + order data
  const emails = persons.map((p: any) => p.email).filter(Boolean);
  let medusaCustomerMap = new Map<string, any>(); // keyed by email
  let orderCountByCustomerId = new Map<string, number>();

  if (emails.length > 0) {
    try {
      const customerModule = req.scope.resolve(Modules.CUSTOMER);
      const medusaCustomers: any[] = await (customerModule as any).listCustomers(
        { email: { $in: emails } },
        { select: ["id", "email", "has_account", "created_at"] }
      );
      for (const c of medusaCustomers) {
        medusaCustomerMap.set(c.email, c);
      }
      const customerIds = medusaCustomers.map((c: any) => c.id);
      if (customerIds.length > 0) {
        const orderModule = req.scope.resolve(Modules.ORDER);
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
      // non-fatal
    }
  }

  const now = new Date();

  // Enrich members with person + customer data
  const enrichedMembers = members.map((member: any) => {
    const person = personMap.get(member.person_id) as any;
    const medusaCustomer = person ? medusaCustomerMap.get(person.email) : undefined;

    let customer_since_days: number | null = null;
    if (medusaCustomer?.created_at) {
      customer_since_days = Math.floor(
        (now.getTime() - new Date(medusaCustomer.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    return {
      ...member,
      person: person
        ? {
            id: person.id,
            email: person.email,
            first_name: person.first_name,
            last_name: person.last_name,
            phone: person.phone,
            state: person.state,
          }
        : null,
      customer: medusaCustomer
        ? {
            id: medusaCustomer.id,
            has_account: medusaCustomer.has_account,
            customer_since_days,
            order_count: orderCountByCustomerId.get(medusaCustomer.id) ?? 0,
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
    count: totalCount,
    offset: params.offset,
    limit: params.limit,
  });
};
