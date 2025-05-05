import { useTranslation } from "react-i18next";
import { z } from "zod";
import { toast } from "sonner";
import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useRouteModal } from "../modal/use-route-modal";
import { useUpdateDesign, AdminDesign } from "../../hooks/api/designs";
import { DatePicker } from "@medusajs/ui";

const designSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  design_type: z.enum(["Original", "Derivative", "Custom", "Collaboration"]).optional(),
  inspiration_sources: z.string().optional(),
  status: z.enum(["Conceptual", "In_Development", "Technical_Review", "Sample_Production", "Revision", "Approved", "Rejected", "On_Hold"]).optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(),
  target_completion_date: z.date().nullable(),
  designer_notes: z.string().optional(),
  estimated_cost: z.number().optional(),
  tags: z.string().optional(),
});

type DesignFormData = z.infer<typeof designSchema>;

const designTypeOptions = [
  { value: "Original", label: "Original" },
  { value: "Derivative", label: "Derivative" },
  { value: "Custom", label: "Custom" },
  { value: "Collaboration", label: "Collaboration" },
];

const statusOptions = [
  { value: "Conceptual", label: "Conceptual" },
  { value: "In_Development", label: "In Development" },
  { value: "Technical_Review", label: "Technical Review" },
  { value: "Sample_Production", label: "Sample Production" },
  { value: "Revision", label: "Revision" },
  { value: "Approved", label: "Approved" },
  { value: "Rejected", label: "Rejected" },
  { value: "On_Hold", label: "On Hold" },
];

const priorityOptions = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Medium" },
  { value: "High", label: "High" },
  { value: "Urgent", label: "Urgent" },
];

type EditDesignFormProps = {
  design: AdminDesign;
};

const DatePickerField = ({ value, onChange }: any) => (
  <DatePicker
    value={value}
    onChange={(date) => {
      onChange(date);
    }}
  />
);

export const EditDesignForm = ({ design }: EditDesignFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useUpdateDesign(design.id);

  const handleSubmit = async (data: DesignFormData) => {
    const stringToArray = (str?: string) => 
      str ? str.split(",").map(item => item.trim()).filter(Boolean) : undefined;

    await mutateAsync(
      {
        name: data.name,
        description: data.description,
        design_type: data.design_type,
        inspiration_sources: stringToArray(data.inspiration_sources as string),
        target_completion_date: data.target_completion_date as  Date,
        status: data.status,
        priority: data.priority,
        estimated_cost: data.estimated_cost,
        tags: stringToArray(data.tags as string),
      },
      {
        onSuccess: ({ design }) => {
          toast.success(
            t("designs.updateSuccess", {
              name: design.name,
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

  const fields: FieldConfig<DesignFormData>[] = [
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
      name: "design_type",
      type: "select",
      label: t("Design Type"),
      options: designTypeOptions,
      gridCols: 1
    },
    {
      name: "inspiration_sources",
      type: "text",
      label: t("Inspiration Sources"),
      hint: t("Comma separated values"),
    },
    {
      name: "target_completion_date",
      type: "custom",
      label: t("Target Date"),
      required: true,
      customComponent: DatePickerField,
      gridCols: 1
    },
    {
      name: "status",
      type: "select",
      label: t("fields.status"),
      options: statusOptions,
      gridCols: 1
    },
    {
      name: "priority",
      type: "select",
      label: t("fields.priority"),
      options: priorityOptions,
      gridCols: 1
    },
    {
      name: "estimated_cost",
      type: "number",
      label: t("Estimated Cost"),
    }
  ];

  const formatArrayToString = (arr?: string[]) => arr?.join(", ") || "";

  return (
    <DynamicForm
      fields={fields}
      defaultValues={{
        name: design.name,
        description: design.description,
        design_type: design.design_type,
        inspiration_sources: formatArrayToString(design.inspiration_sources),
        target_completion_date: new Date(design.target_completion_date),
        status: design.status,
        priority: design.priority,
        estimated_cost: design.estimated_cost,
      }}
      onSubmit={handleSubmit}
      isPending={isPending}
      layout={{ showDrawer: true, gridCols: 1 }}
    />
  );
};
