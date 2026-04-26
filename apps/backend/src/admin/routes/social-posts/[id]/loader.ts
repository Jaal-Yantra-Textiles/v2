import { socialPostsQueryKeys } from "../../../hooks/api/social-posts";
import { sdk } from "../../../lib/config";
import { queryClient } from "../../../lib/query-client";
import { SOCIAL_POST_DETAIL_FIELDS } from "./constants";

const socialPostDetailQuery = (id: string) => ({
  queryKey: socialPostsQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ socialPost: any }>(`/admin/social-posts/${id}`, {
      method: "GET",
      query: {
        fields: SOCIAL_POST_DETAIL_FIELDS,
      },
    }),
})

export const socialPostLoader = async ({ params }: any) => {
  const id = params.id
  const query = socialPostDetailQuery(id!)

  const response = await queryClient.ensureQueryData({
    ...query,
  })

  return response
}
