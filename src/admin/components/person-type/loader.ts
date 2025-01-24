import { LoaderFunctionArgs } from "react-router-dom";
import { queryClient } from "../../lib/query-client";
import { sdk } from "../../lib/sdk";
import { personTypeQueryKeys } from "../../hooks/api/persontype";
import { AdminPersonType } from "./person-type-general-section";


const personTypeDetailQuery = (id: string) => ({
  queryKey: personTypeQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ personType: AdminPersonType }>(
      `/admin/persontype/${id}`,
      {
        method: "GET",
      },
    ),
});

export const personTypeLoader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.id;
  const query = personTypeDetailQuery(id!);

  return queryClient.ensureQueryData(query);
};
