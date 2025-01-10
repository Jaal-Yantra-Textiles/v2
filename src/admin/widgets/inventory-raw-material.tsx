import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Container, Heading, usePrompt, Text, StatusBadge, toast } from "@medusajs/ui"
import { useNavigate } from "react-router-dom"
import { ActionMenu } from "../components/common/action-menu"
import { Button } from "@medusajs/ui"
import { PencilSquare, Plus, Trash } from "@medusajs/icons"
import { useInventoryItem } from "../hooks/api/raw-materials"

const materialStatusColor = (status: string) => {
  switch (status) {
    case "Active":
      return "green"
    case "Discontinued":
      return "red"
    case "Under_Review":
      return "orange"
    case "Development":
      return "blue"
    default:
      return "grey"
  }
}

type RawMaterial = {
  id: string
  name: string
  description: string
  composition: string
  specifications: any | null
  unit_of_measure: string
  minimum_order_quantity: number
  lead_time_days: number
  color: string
  width: string
  weight: string
  grade: string
  certification: any | null
  usage_guidelines: string | null
  storage_requirements: string | null
  status: string
  metadata: any | null
  material_type_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  material_type: {
    id: string
    name: string
    description: string | null
    category: string
    properties: any | null
    metadata: any | null
    created_at: string
    updated_at: string
    deleted_at: string | null
  }
}

type AdminInventory = {
  id: string
  raw_materials?: RawMaterial
}

const InventoryRawMaterialWidget = ({ 
  data,
}: DetailWidgetProps<AdminInventory>) => {
  const navigate = useNavigate()
  const prompt = usePrompt()

  const {
    inventory_item,
    isPending: isLoading,
    isError,
    error,
  } = useInventoryItem(
    data.id!,
    {
      fields: "+raw_materials.*, +raw_materials.material_type.*",
    },
  )

  const handleDelete = async (rawMaterialId: string) => {
    const confirmed = await prompt({
      title: "Delete Raw Material",
      description: "Are you sure you want to delete this raw material? This action cannot be undone.",
    })

    if (!confirmed) {
      return
    }

    try {
      toast.success("Raw material deleted successfully")
    } catch (error) {
      toast.error(error)
    }
  }

  const getItemActionGroups = (rawMaterialId: string) => [
    {
      actions: [
        {
          label: "Edit",
          icon: <PencilSquare />,
          onClick: () => navigate(`/inventory/${data.id}/raw-materials/${rawMaterialId}/edit`),
        },
      ],
    },
    {
      actions: [
        {
          label: "Delete",
          icon: <Trash />,
          variant: "danger",
          onClick: () => handleDelete(rawMaterialId),
        },
      ],
    },
  ]

  const shouldShowAddAction = !inventory_item?.raw_materials

  if (isLoading) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-center h-40">
          <Text>Loading...</Text>
        </div>
      </Container>
    )
  }

  if (isError) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-center h-40">
          <Text className="text-ui-fg-error">{error?.message || "An error occurred"}</Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading level="h2">Raw Materials</Heading>
          {inventory_item?.raw_materials && (
            <StatusBadge color={materialStatusColor(inventory_item.raw_materials.status)}>
              {inventory_item.raw_materials.status}
            </StatusBadge>
          )}
        </div>
        {inventory_item?.raw_materials && (
          <ActionMenu groups={getItemActionGroups(inventory_item.raw_materials.id)} />
        )}
        {shouldShowAddAction && (
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: "Add Raw Material",
                    icon: <Plus />,
                    to: `raw-materials/create`,
                  },
                ],
              },
            ]}
          />
        )}
      </div>

      <div className="p-0">
        {!inventory_item?.raw_materials ? (
          <div className="flex flex-col items-center justify-center h-32 border rounded-lg">
            <p className="text-ui-fg-subtle mb-4">No raw materials added yet</p>
            <Button
              variant="secondary"
              onClick={() => navigate(`/inventory/${data.id}/raw-materials/create`)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Raw Material
            </Button>
          </div>
        ) : (
          <>
            <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-b">
              <Text size="small" leading="compact" weight="plus">
                Material Name
              </Text>
              <Text size="small" leading="compact">
                {inventory_item.raw_materials.name || "-"}
              </Text>
            </div>

            {/* Material Type */}
            <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-b">
              <Text size="small" leading="compact" weight="plus">
                Material Type
              </Text>
              <div className="flex items-center gap-x-2">
                <Badge color="blue" size="small">
                  {inventory_item.raw_materials.material_type?.name || "-"}
                </Badge>
                <Badge color="grey" size="small">
                  {inventory_item.raw_materials.material_type?.category || "-"}
                </Badge>
              </div>
            </div>

            {/* Specifications */}
            <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-b">
              <Text size="small" leading="compact" weight="plus">
                Composition
              </Text>
              <Text size="small" leading="compact">
                {inventory_item.raw_materials.composition || "-"}
              </Text>
            </div>

            <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-b">
              <Text size="small" leading="compact" weight="plus">
                Unit of Measure
              </Text>
              <Text size="small" leading="compact">
                {inventory_item.raw_materials.unit_of_measure || "-"}
              </Text>
            </div>

            {inventory_item.raw_materials.color && (
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-b">
                <Text size="small" leading="compact" weight="plus">
                  Color
                </Text>
                <Text size="small" leading="compact">
                  {inventory_item.raw_materials.color}
                </Text>
              </div>
            )}

            {inventory_item.raw_materials.width && (
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-b">
                <Text size="small" leading="compact" weight="plus">
                  Width
                </Text>
                <Text size="small" leading="compact">
                  {inventory_item.raw_materials.width}
                </Text>
              </div>
            )}

            {inventory_item.raw_materials.weight && (
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-b">
                <Text size="small" leading="compact" weight="plus">
                  Weight
                </Text>
                <Text size="small" leading="compact">
                  {inventory_item.raw_materials.weight}
                </Text>
              </div>
            )}

            {inventory_item.raw_materials.grade && (
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-b">
                <Text size="small" leading="compact" weight="plus">
                  Grade
                </Text>
                <Text size="small" leading="compact">
                  {inventory_item.raw_materials.grade}
                </Text>
              </div>
            )}

            {/* Order Details */}
            {inventory_item.raw_materials.minimum_order_quantity && (
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-b">
                <Text size="small" leading="compact" weight="plus">
                  Minimum Order Quantity
                </Text>
                <Text size="small" leading="compact">
                  {inventory_item.raw_materials.minimum_order_quantity}
                </Text>
              </div>
            )}

            {inventory_item.raw_materials.lead_time_days && (
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-b">
                <Text size="small" leading="compact" weight="plus">
                  Lead Time
                </Text>
                <Text size="small" leading="compact">
                  {inventory_item.raw_materials.lead_time_days} days
                </Text>
              </div>
            )}

            {/* Requirements */}
            {inventory_item.raw_materials.usage_guidelines && (
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-b">
                <Text size="small" leading="compact" weight="plus">
                  Usage Guidelines
                </Text>
                <Text size="small" leading="compact">
                  {inventory_item.raw_materials.usage_guidelines}
                </Text>
              </div>
            )}

            {inventory_item.raw_materials.storage_requirements && (
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4 border-b">
                <Text size="small" leading="compact" weight="plus">
                  Storage Requirements
                </Text>
                <Text size="small" leading="compact">
                  {inventory_item.raw_materials.storage_requirements}
                </Text>
              </div>
            )}

            {/* Dates */}
            <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
              <Text size="small" leading="compact" weight="plus">
                Created At
              </Text>
              <Text size="small" leading="compact">
                {new Date(inventory_item.raw_materials.created_at).toLocaleDateString()}
              </Text>
            </div>
          </>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
    zone: "inventory_item.details.side.after",
})

export default InventoryRawMaterialWidget