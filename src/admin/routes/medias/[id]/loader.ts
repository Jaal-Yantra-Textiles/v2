import { mediaFolderDetailQueryKeys } from "../../../hooks/api/media-folders/use-media-folder-detail";
import { sdk } from "../../../lib/config";
import { queryClient } from "../../../lib/query-client";


const mediaFolderDetailQuery = (id: string) => ({
  queryKey: mediaFolderDetailQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<any>(`/admin/medias/folder/${id}/detail`, {
      method: "GET",
    }),
})

export const mediaFolderLoader = async ({ params }: any) => {
  const id = params.id
  const query = mediaFolderDetailQuery(id!)

  const data = await queryClient.ensureQueryData(query);
  
  // Return the entire detail payload for use as initialData
  return data;
};
