import { agreementQueryKeys } from "../../../../hooks/api/agreement";
import { sdk } from "../../../../lib/config";
import { queryClient } from "../../../../lib/query-client";

const agreementDetailQuery = (id: string) => ({
  queryKey: agreementQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ agreement: any }>(`/admin/agreements/${id}`, {
      method: "GET",
    }),
});

export const agreementLoader = async ({ params }: any) => {
  const id = params.id;
  const query = agreementDetailQuery(id!);

  return queryClient.ensureQueryData(query);
};
