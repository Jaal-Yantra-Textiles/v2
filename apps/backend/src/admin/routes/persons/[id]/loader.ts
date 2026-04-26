import { personsQueryKeys } from "../../../hooks/api/persons";
import { sdk } from "../../../lib/config";
import { queryClient } from "../../../lib/query-client";
import { PERSON_DETAIL_FIELDS } from "./constants";

const personDetailQuery = (id: string) => ({
  queryKey: personsQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ person: any }>(`/admin/persons/${id}`, {
      method: "GET",
      query: {
        fields: PERSON_DETAIL_FIELDS,
      },
    }),
});

export const personLoader = async ({ params } : any) => {
  const id = params.id;
  const query = personDetailQuery(id!);

  return queryClient.ensureQueryData(query);
};
