import { websiteQueryKeys } from "../../../hooks/api/websites";
import { sdk } from "../../../lib/config";
import { queryClient } from "../../../lib/query-client";

const websiteDetailQuery = (id: string) => ({
  queryKey: websiteQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ website: any }>(`/admin/websites/${id}`, {
      method: "GET",
    }),
});

export const websiteLoader = async ({ params }: any) => {
  const id = params.id;
  const query = websiteDetailQuery(id!);

  return queryClient.ensureQueryData(query);
};
