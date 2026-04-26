import { socialPlatformsQueryKeys } from "../../../../hooks/api/social-platforms";
import { sdk } from "../../../../lib/config";
import { queryClient } from "../../../../lib/query-client";

const socialPlatformDetailQuery = (id: string) => ({
  queryKey: socialPlatformsQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ socialPlatform: any }>(`/admin/social-platforms/${id}`, {
      method: "GET",
    }),
});

export const socialPlatformLoader = async ({ params }: any) => {
  const id = params.id;
  const query = socialPlatformDetailQuery(id!);

  return queryClient.ensureQueryData(query);
};
