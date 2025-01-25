import { useTranslation } from "react-i18next";
import { z } from "zod";
import { AdminTaskTemplate, useUpdateTaskTemplate } from "../../hooks/api/task-templates";
import { useTaskTemplateCategories } from "../../hooks/api/task-template-categories";
import { CategorySearch } from "../common/category-search";
import { useState } from "react";
import { toast } from "sonner";
import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useRouteModal } from "../modal/use-route-modal";

const taskTemplateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  category: z.object({
    id: z.string().optional(),
    name: z.string().min(1, "Category name is required"),
    description: z.string().optional(),
  }),
  estimated_duration: z.number().min(0),
  priority: z.enum(["low", "medium", "high"]),
  eventable: z.boolean(),
  notifiable: z.boolean(),
  message_template: z.string().optional(),
});

type TaskTemplateFormData = z.infer<typeof taskTemplateSchema>;

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

type EditTaskTemplateFormProps = {
  template: AdminTaskTemplate;
};

export const EditTaskTemplateForm = ({ template }: EditTaskTemplateFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const [searchQuery, setSearchQuery] = useState("");
  
  const { categories = [] } = useTaskTemplateCategories(
    searchQuery.length >= 3 ? { name: searchQuery } : undefined
  );

  const { mutateAsync, isPending } = useUpdateTaskTemplate(template.id!);

  const handleSubmit = async (data: TaskTemplateFormData) => {
    await mutateAsync(
      {
        name: data.name,
        description: data.description,
        category: data.category.id 
          ? { 
              id: data.category.id,
              name: data.category.name,
              description: data.category.description,
            }
          : {
              name: data.category.name,
              description: data.category.description || "",
            },
        priority: data.priority,
        estimated_duration: data.estimated_duration,
        eventable: data.eventable,
        notifiable: data.notifiable,
        message_template: data.message_template,
      },
      {
        onSuccess: ({ task_template }) => {
          toast.success(
            t("taskTemplate.updateSuccess", {
              name: task_template.name,
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

  const fields: FieldConfig<TaskTemplateFormData>[] = [
    {
      name: "name",
      type: "text",
      label: t("fields.name"),
      required: true,
    },
    {
      name: "description",
      type: "text",
      label: t("fields.description"),
    },
    {
      name: "category",
      type: "custom",
      label: t("fields.category"),
      customComponent: CategorySearch,
      customProps: {
        categories,
        defaultValue: template.category || "",
        onSelect: (category: any) => ({
          id: category?.id,
          name: category?.name,
          description: category?.description || "",
        }),
        onValueChange: (value: string) => {
          setSearchQuery(value);
          return {
            id: undefined,
            name: value,
          };
        },
      },
    },
    {
      name: "priority",
      type: "select",
      label: t("fields.priority"),
      options: priorityOptions,
      required: true,
      gridCols: 1,
    },
    {
      name: "estimated_duration",
      type: "number",
      label: t("fields.estimatedDuration"),
      required: true,
      gridCols: 1,
    },
    {
      name: "eventable",
      type: "switch",
      label: t("fields.eventable"),
      hint: t("taskTemplate.eventableDescription"),
    },
    {
      name: "notifiable",
      type: "switch",
      label: t("fields.notifiable"),
      hint: t("taskTemplate.notifiableDescription"),
    },
    {
      name: "message_template",
      type: "text",
      label: t("fields.messageTemplate"),
    },
  ];

  return (
    <DynamicForm<TaskTemplateFormData>
      fields={fields}
      defaultValues={{
        name: template.name,
        description: template.description,
        category: {
          id: template.category?.id,
          name: template.category?.name || "",
          description: template.category?.description || "",
        },
        estimated_duration: template.estimated_duration || 0,
        priority: template.priority || "medium",
        eventable: template.eventable || false,
        notifiable: template.notifiable || false,
        message_template: template.message_template || "",
      }}
      onSubmit={handleSubmit}
      customValidation={taskTemplateSchema}
      layout={{
        showDrawer: true,
        gridCols: 1,
      }}
      isPending={isPending}
    />
  );
};
