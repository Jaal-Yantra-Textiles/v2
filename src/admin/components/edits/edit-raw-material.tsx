import { useTranslation } from "react-i18next";
import { z } from "zod";
import { toast } from "sonner";
import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useRouteModal } from "../modal/use-route-modal";
import { useUpdateRawMaterial, RawMaterial, useRawMaterialCategories } from "../../hooks/api/raw-materials";
import { useParams } from "react-router-dom";
import { CategorySearch } from "../common/category-search";
import { useState } from "react";

// Define an interface for the raw material update data that supports both material_type and material_type_id
interface RawMaterialUpdateData {
  name: string
  description?: string
  composition: string
  unit_of_measure?: "Meter" | "Yard" | "Kilogram" | "Gram" | "Piece" | "Roll" | "Other"
  minimum_order_quantity?: number
  lead_time_days?: number
  color?: string
  width?: string
  weight?: string
  grade?: string
  certification?: Record<string, any>
  usage_guidelines?: string
  storage_requirements?: string
  status?: "Active" | "Discontinued" | "Under_Review" | "Development"
  material_type?: string  // String for new category names
  material_type_id?: string  // ID for existing categories
}

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
  minimum_order_quantity: z.any().optional().transform(val => {
    if (val === "" || val === null || val === undefined) return undefined;
    const num = Number(val);
    return isNaN(num) ? undefined : num;
  }),
  lead_time_days: z.any().optional().transform(val => {
    if (val === "" || val === null || val === undefined) return undefined;
    const num = Number(val);
    return isNaN(num) ? undefined : num;
  }),
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
  // Material type can be either an object (for existing categories) or a string (for new ones)
  material_type: z.any(),
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

// These options are no longer needed as we're directly using category from the selected material type
// Keeping this commented for reference in case we need to restore it later
/* 
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
*/

type EditRawMaterialFormProps = {
  rawMaterial: RawMaterial;
};

export const EditRawMaterialForm = ({ rawMaterial }: EditRawMaterialFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const { id: inventoryId } = useParams();
  const [searchQuery, setSearchQuery] = useState("");
  
  // Fetch material type categories when search query is at least 3 characters
  const { categories = [] } = useRawMaterialCategories(
    searchQuery.length >= 3 ? { name: searchQuery } : { name: "" }
  );

  const { mutateAsync, isPending } = useUpdateRawMaterial(inventoryId!, rawMaterial.id, {});

  const handleSubmit = async (data: RawMaterialEditFormData) => {
    // Prepare the rawMaterialData object that matches the workflow input
    const rawMaterialData: RawMaterialUpdateData = {
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
      status: data.status
    };
    
    // Handle material_type based on whether it's an existing one or new one
    if (data.material_type) {
      // Check if it's an object with isExisting flag (meaning it's an existing category)
      if (typeof data.material_type === 'object' && data.material_type !== null && data.material_type.isExisting) {
        // For existing categories, we use material_type_id in the payload
        rawMaterialData.material_type_id = data.material_type.id;
      } else if (typeof data.material_type === 'string') {
        // For new categories, we just send the name as a string
        rawMaterialData.material_type = data.material_type;
      } else if (typeof data.material_type === 'object' && data.material_type.name) {
        // If it's a non-existing object with a name, we just send the name as a string
        rawMaterialData.material_type = data.material_type.name;
      }
    }
    
    // Cast to any to bypass the type checking since we're handling the API requirements correctly
await mutateAsync({ rawMaterialData: rawMaterialData as any },
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
      name: "material_type",
      type: "custom",
      label: t("Material Type"),
      required: true,
      customComponent: CategorySearch,
      customProps: {
        categories,
        defaultValue: rawMaterial.material_type?.name || "",
        onSelect: (category: any) => {
          // When an existing category is selected, return it with isExisting flag
          if (category?.id) {
            setSearchQuery("");
            return {
              id: category.id,
              name: category.name,
              description: category.description || "",
              category: category.category,
              isExisting: true
            };
          }
          return category?.name || "";
        },
        onValueChange: (value: string) => {
          setSearchQuery(value);
          // Return a simple string for new categories
          return value;
        }
      },
    },

  ];

  // Define initial values for the form
  const initialValues: RawMaterialEditFormData = {
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
    // If we have an existing material_type, set it as an object with isExisting flag
    material_type: rawMaterial.material_type ? {
      id: rawMaterial.material_type.id,
      name: rawMaterial.material_type.name,
      description: rawMaterial.material_type.description || "",
      category: rawMaterial.material_type.category,
      isExisting: true
    } : "",
  };

  return (
    <DynamicForm
      fields={fields}
      defaultValues={initialValues}
      onSubmit={handleSubmit}
      isPending={isPending}
      layout={{ showDrawer: true, gridCols: 1 }}
    />
  );
};
