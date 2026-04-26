import { taskTemplateQueryKeys } from "../../../../hooks/api/task-templates";
import { sdk } from "../../../../lib/config";
import { queryClient } from "../../../../lib/query-client";

const taskTemplateDetailQuery = (id: string) => ({
  queryKey: taskTemplateQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ task_template: any }>(`/admin/task-templates/${id}`, {
      method: "GET",
    }),
});

export const taskTemplateLoader = async ({ params }: any) => {
  const id = params.id;
  const query = taskTemplateDetailQuery(id!);

  return queryClient.ensureQueryData(query);
};
