import { useTranslation } from "react-i18next";
import { z } from "@medusajs/framework/zod";
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
  category: z.union([
    z.string(),
    z.object({
      id: z.string(),
      name: z.string(),
      isExisting: z.boolean().optional()
    })
  ]).optional(),
  estimated_duration: z.number().min(0),
  estimated_cost: z.number().min(0).optional(),
  cost_currency: z.string().optional(),
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
    // Create request payload
    const payload: any = {
      name: data.name,
      description: data.description,
      priority: data.priority,
      estimated_duration: data.estimated_duration,
      estimated_cost: data.estimated_cost || undefined,
      cost_currency: data.cost_currency || undefined,
      eventable: data.eventable,
      notifiable: data.notifiable,
      message_template: data.message_template,
    };
    
    // Handle category based on whether it's an existing one or new
    if (data.category) {
      // Check if it's an object with isExisting flag
      if (typeof data.category === 'object' && data.category !== null) {
        if (data.category.isExisting) {
          // For existing categories, send the ID as category_id
          payload.category_id = data.category.id;
          // Make sure we don't also send category name
          delete payload.category;
        } else if (data.category.name) {
          // If it has a name but not isExisting, it might be a different object format
          payload.category = data.category.name;
        }
      } else if (typeof data.category === 'string') {
        // For new categories, send the name string as category
        payload.category = data.category;
        // Make sure we don't accidentally send a category_id
        delete payload.category_id;
      }
    }
    

    
    await mutateAsync(payload,
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
        defaultValue: (typeof template.category === "object" ? template.category?.name : template.category) || "",
        onSelect: (category: any) => {
          if (category?.id) {
            return { id: category.id, name: category.name, isExisting: true };
          }
          return category?.name || "";
        },
        onValueChange: (value: string) => {
          setSearchQuery(value);
          return value;
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
      name: "estimated_cost",
      type: "number",
      label: "Estimated Cost",
      gridCols: 1,
    },
    {
      name: "cost_currency",
      type: "text",
      label: "Cost Currency",
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
        category: typeof template.category === "object" && template.category?.id ?
          { id: template.category.id, name: template.category.name, isExisting: true } :
          (typeof template.category === "object" ? template.category?.name : template.category) || "",
        estimated_duration: template.estimated_duration || 0,
        estimated_cost: template.estimated_cost || undefined,
        cost_currency: template.cost_currency || "",
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
