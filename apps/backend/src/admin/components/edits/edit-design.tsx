import { useTranslation } from "react-i18next";
import { z } from "@medusajs/framework/zod";
import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useRouteModal } from "../modal/use-route-modal";
import {
  useUpdateDesign,
  useInferDesignProductType,
  AdminDesign,
} from "../../hooks/api/designs";
import { Badge, Button, DatePicker, Input, Text, toast } from "@medusajs/ui";

const designSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  design_type: z.enum(["Original", "Derivative", "Custom", "Collaboration"]).optional(),
  product_type: z.string().optional(),
  inspiration_sources: z.string().optional(),
  status: z.enum(["Conceptual", "In_Development", "Technical_Review", "Sample_Production", "Revision", "Approved", "Rejected", "On_Hold", "Commerce_Ready", "Superseded"]).optional(),
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
  { value: "Commerce_Ready", label: "Commerce Ready" },
  { value: "Superseded", label: "Superseded" },
];

const priorityOptions = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Medium" },
  { value: "High", label: "High" },
  { value: "Urgent", label: "Urgent" },
];

/**
 * The garment type (#938), with its PROVENANCE on show and a way to re-ask.
 *
 * 🔑 The badge is the point. An inferred type reads as provisional so nobody
 * mistakes a model's guess for a decision a designer made — the type drives the
 * production spec, and therefore what the design costs. Typing over it and
 * saving makes it `manual`, after which no inference will touch it.
 *
 * "Suggest" sends `force` precisely because the plain call refuses to overwrite
 * a manual value: a human pressing this button IS the human asking, which is a
 * different thing from a model overruling one.
 */
const ProductTypeField = ({ value, onChange, design }: any) => {
  const { mutateAsync: infer, isPending } = useInferDesignProductType(design.id);
  const source = design.product_type_source as string | null | undefined;

  const handleSuggest = async () => {
    try {
      const res = await infer({ force: true });
      if (res.inference.skipped) {
        toast.info("No garment type could be determined from this design");
        return;
      }
      onChange(res.inference.product_type ?? "");
      const pct =
        res.inference.confidence != null
          ? ` (${Math.round(res.inference.confidence * 100)}% confident)`
          : "";
      toast.success(`Suggested "${res.inference.product_type}"${pct}`);
    } catch (e: any) {
      // Never fatal — a designer can always type the type themselves.
      toast.error(e?.message || "Could not suggest a garment type");
    }
  };

  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex items-center gap-x-2">
        <Input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="trousers, saree, kurta…"
        />
        <Button
          type="button"
          variant="secondary"
          size="small"
          onClick={handleSuggest}
          isLoading={isPending}
        >
          Suggest
        </Button>
      </div>
      {source ? (
        <div className="flex items-center gap-x-2">
          <Badge size="2xsmall" color={source === "manual" ? "green" : "orange"}>
            {source === "manual" ? "Set by you" : "AI suggested"}
          </Badge>
          {source === "inferred" ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              Not yet confirmed
            </Text>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

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
        // Empty string means "clear it" — the API takes null to hand the type
        // back to inference, and would otherwise store "" as a manual value.
        product_type: data.product_type?.trim() ? data.product_type.trim() : null,
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
      name: "product_type",
      type: "custom",
      label: t("Garment Type"),
      customComponent: ProductTypeField,
      customProps: { design },
      hint:
        design.product_type_source === "inferred"
          ? t(
              "Suggested by AI — edit to confirm. Saving marks it as yours, and it will not be re-suggested."
            )
          : t(
              "What this design is (trousers, saree). Drives the production spec. Leave blank to have it suggested."
            ),
      gridCols: 1,
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
        product_type: design.product_type ?? "",
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
