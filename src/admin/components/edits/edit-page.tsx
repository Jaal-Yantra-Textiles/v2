import { useTranslation } from "react-i18next";
import { z } from "zod";
import { toast } from "sonner";
import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useRouteModal } from "../modal/use-route-modal";
import { useUpdatePage, type AdminPage } from "../../hooks/api/pages";

const pageSchema = z.object({
  slug: z.string().min(1, "Slug is required"),
  status: z.enum(["Draft", "Published", "Archived"]).optional(),
  meta_title: z.string().optional(),
  meta_description: z.string().optional(),
  meta_keywords: z.string().optional(),
  content: z.string().optional(),
});

type PageFormData = z.infer<typeof pageSchema>;

const statusOptions = [
  { value: "Draft", label: "Draft" },
  { value: "Published", label: "Published" },
  { value: "Archived", label: "Archived" },
];

type EditPageFormProps = {
  page: AdminPage;
  websiteId: string;
};

export const EditPageForm = ({ page, websiteId }: EditPageFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useUpdatePage(websiteId, page.id);

  const handleSubmit = async (data: PageFormData) => {
    await mutateAsync(
      {
        slug: data.slug,
        status: data.status,
        meta_title: data.meta_title,
        meta_description: data.meta_description,
        meta_keywords: data.meta_keywords,
        content: data.content,
      },
      {
        onSuccess: ({ page }) => {
          toast.success(
            t("pages.updateSuccess", {
              title: page.title,
            })
          );
          handleSuccess();
        },
        onError: (error) => {
          toast.error(error.message);
        },
      }
    );
  };

  const fields: FieldConfig<PageFormData>[] = [
    {
      name: "slug",
      label: t("pages.fields.slug"),
      type: "text",
      required: true,
      hint: t("pages.hints.slug"),
    },
    {
      name: "status",
      label: t("pages.fields.status"),
      type: "select",
      options: statusOptions,
    },
    {
      name: "content",
      label: t("pages.fields.content"),
      type: "text",
      required: true,
    },
    {
      name: "meta_title",
      label: t("pages.fields.metaTitle"),
      type: "text",
    },
    {
      name: "meta_description",
      label: t("pages.fields.metaDescription"),
      type: "text",
    },
    {
      name: "meta_keywords",
      label: t("pages.fields.metaKeywords"),
      type: "text",
      hint: t("pages.hints.metaKeywords"),
    },
  ];

  return (
    <DynamicForm
      fields={fields}
      defaultValues={{
        slug: page.slug,
        status: page.status,
        meta_title: page.meta_title,
        meta_description: page.meta_description,
        meta_keywords: page.meta_keywords,
        content: page.content,
      }}
      onSubmit={handleSubmit}
      isPending={isPending}
    />
  );
};
