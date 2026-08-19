import { sdk } from "../../../lib/config";
import { queryClient } from "../../../lib/query-client";

/**
 * Loaded before the route renders so the breadcrumb can say the contact's NAME
 * rather than `per_01J…`. The breadcrumb reads `match.data`, which only exists
 * if the route has a loader — an id-only crumb is what you get otherwise, and
 * an id in a trail is not navigation, it is a receipt.
 *
 * Shares the `crm-person` query key with the page, so this is one request, not
 * two: the component's `useQuery` reads the cache this warmed.
 */
const crmPersonDetailQuery = (id: string) => ({
  queryKey: ["crm-person", id],
  queryFn: async () =>
    sdk.client.fetch<{ crm_person: any }>(`/admin/crm/people/${id}`, {
      method: "GET",
    }),
});

export const crmPersonLoader = async ({ params }: any) => {
  const id = params.id;
  return queryClient.ensureQueryData(crmPersonDetailQuery(id!));
};
