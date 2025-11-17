import { emailTemplatesQueryKeys } from "../../../../hooks/api/email-templates";
import { sdk } from "../../../../lib/config";
import { queryClient } from "../../../../lib/query-client";

const emailTemplateDetailQuery = (id: string) => ({
  queryKey: emailTemplatesQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ emailTemplate: any }>(`/admin/email-templates/${id}`, {
      method: "GET",
    }),
});

export const emailTemplateLoader = async ({ params }: any) => {
  const id = params.id;
  const query = emailTemplateDetailQuery(id!);

  return queryClient.ensureQueryData(query);
};
