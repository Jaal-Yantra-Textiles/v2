import { useTranslation } from "react-i18next";
import { z } from "zod";
import { toast } from "sonner";
import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useRouteModal } from "../modal/use-route-modal";
import { useUpdateRawMaterial, useRawMaterial, RawMaterial } from "../../hooks/api/raw-materials";
import { useParams } from "react-router-dom";

const rawMaterialEditSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  composition: z.string().min(1, "Composition is required"),
  unit_of_measure: z.enum([
    "Meter",
    "Yard",
    "Kilogram",
    "Gram",
    "Piece",
    "Roll",
    "Other"
  ]),
  minimum_order_quantity: z.number().positive().optional(),
  lead_time_days: z.number().positive().optional(),
  color: z.string().optional(),
  width: z.string().optional(),
  weight: z.string().optional(),
  grade: z.string().optional(),
  usage_guidelines: z.string().optional(),
  storage_requirements: z.string().optional(),
  status: z.enum([
    "Active",
    "Discontinued",
    "Under_Review",
    "Development"
  ]),
  material_type_name: z.string().min(1, "Material type name is required"),
  material_type_description: z.string().optional(),
  material_type_category: z.enum([
    "Fiber",
    "Yarn",
    "Fabric",
    "Trim",
    "Dye",
    "Chemical",
    "Accessory",
    "Other"
  ]),
});

type RawMaterialEditFormData = z.infer<typeof rawMaterialEditSchema>;

const unitOfMeasureOptions = [
  { value: "Meter", label: "Meter" },
  { value: "Yard", label: "Yard" },
  { value: "Kilogram", label: "Kilogram" },
  { value: "Gram", label: "Gram" },
  { value: "Piece", label: "Piece" },
  { value: "Roll", label: "Roll" },
  { value: "Other", label: "Other" },
];

const statusOptions = [
  { value: "Active", label: "Active" },
  { value: "Discontinued", label: "Discontinued" },
  { value: "Under_Review", label: "Under Review" },
  { value: "Development", label: "Development" },
];

const materialTypeOptions = [
  { value: "Fiber", label: "Fiber" },
  { value: "Yarn", label: "Yarn" },
  { value: "Fabric", label: "Fabric" },
  { value: "Trim", label: "Trim" },
  { value: "Dye", label: "Dye" },
  { value: "Chemical", label: "Chemical" },
  { value: "Accessory", label: "Accessory" },
  { value: "Other", label: "Other" },
];

type EditRawMaterialFormProps = {
  rawMaterial: RawMaterial;
};

export const EditRawMaterialForm = ({ rawMaterial }: EditRawMaterialFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const { id: inventoryId, materialId } = useParams();
  const { mutateAsync, isPending } = useUpdateRawMaterial(inventoryId!, materialId!, {});

  const handleSubmit = async (data: RawMaterialEditFormData) => {
    await mutateAsync(
      {
        rawMaterialData: {
          name: data.name,
          description: data.description,
          composition: data.composition,
          unit_of_measure: data.unit_of_measure,
          minimum_order_quantity: data.minimum_order_quantity,
          lead_time_days: data.lead_time_days,
          color: data.color,
          width: data.width,
          weight: data.weight,
          grade: data.grade,
          usage_guidelines: data.usage_guidelines,
          storage_requirements: data.storage_requirements,
          status: data.status,
          material_type: {
            name: data.material_type_name,
            description: data.material_type_description,
            category: data.material_type_category
          }
        }
      },
      {
        onSuccess: () => {
          toast.success(
            t("raw_materials.updateSuccess", {
              name: data.name,
              defaultValue: `${data.name} updated successfully`,
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

  const fields: FieldConfig<RawMaterialEditFormData>[] = [
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
      required: true,
    },
    {
      name: "composition",
      type: "text",
      label: t("Composition"),
      required: true,
    },
    {
      name: "unit_of_measure",
      type: "select",
      label: t("Unit of Measure"),
      options: unitOfMeasureOptions,
      gridCols: 1
    },
    {
      name: "minimum_order_quantity",
      type: "number",
      label: t("Minimum Order Quantity"),
    },
    {
      name: "lead_time_days",
      type: "number",
      label: t("Lead Time (days)"),
    },
    {
      name: "color",
      type: "text",
      label: t("Color"),
    },
    {
      name: "width",
      type: "text",
      label: t("Width"),
    },
    {
      name: "weight",
      type: "text",
      label: t("Weight"),
    },
    {
      name: "grade",
      type: "text",
      label: t("Grade"),
    },
    {
      name: "usage_guidelines",
      type: "text",
      label: t("Usage Guidelines"),
    },
    {
      name: "storage_requirements",
      type: "text",
      label: t("Storage Requirements"),
    },
    {
      name: "status",
      type: "select",
      label: t("fields.status"),
      options: statusOptions,
      gridCols: 1
    },
    {
      name: "material_type_name",
      type: "text",
      label: t("Material Type Name"),
      required: true,
    },
    {
      name: "material_type_description",
      type: "text",
      label: t("Material Type Description"),
    },
    {
      name: "material_type_category",
      type: "select",
      label: t("Material Type Category"),
      options: materialTypeOptions,
      gridCols: 1
    },
  ];

  return (
    <DynamicForm
      fields={fields}
      defaultValues={{
        name: rawMaterial.name,
        description: rawMaterial.description,
        composition: rawMaterial.composition,
        unit_of_measure: rawMaterial.unit_of_measure,
        minimum_order_quantity: rawMaterial.minimum_order_quantity,
        lead_time_days: rawMaterial.lead_time_days,
        color: rawMaterial.color || "",
        width: rawMaterial.width || "",
        weight: rawMaterial.weight || "",
        grade: rawMaterial.grade || "",
        usage_guidelines: rawMaterial.usage_guidelines || "",
        storage_requirements: rawMaterial.storage_requirements || "",
        status: rawMaterial.status,
        material_type_name: rawMaterial.material_type?.name || "",
        material_type_description: rawMaterial.material_type?.description || "",
        material_type_category: rawMaterial.material_type?.category || "Other",
      }}
      onSubmit={handleSubmit}
      isPending={isPending}
      layout={{ showDrawer: true, gridCols: 1 }}
    />
  );
};
