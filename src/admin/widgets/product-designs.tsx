import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Badge, StatusBadge, usePrompt, Skeleton, Button, Heading } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { useNavigate } from "react-router-dom"
import { ActionMenu } from "../components/common/action-menu"
import { PencilSquare, Plus, Trash } from "@medusajs/icons"
import { useProduct, useUnlinkProductDesign } from "../hooks/api/products"

const designStatusColor = (status: string): "green" | "blue" | "orange" | "grey" | "red" | "purple" => {
  switch (status) {
    case "Commerce_Ready":
      return "green"
    case "Approved":
      return "blue"
    case "In_Development":
      return "orange"
    case "Conceptual":
      return "grey"
    case "Rejected":
      return "red"
    case "On_Hold":
      return "purple"
    default:
      return "grey"
  }
}

type Design = {
  id: string
  name: string
  description?: string
  status: string
  priority: string
  design_type: string
  created_at: string
  updated_at: string
}

type AdminProduct = {
  id: string
  designs?: Design[]
}

type ProductWithDesigns = {
  id: string
  designs?: Design[]
  [key: string]: any
}

const ProductDesignsWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const navigate = useNavigate()
  const prompt = usePrompt()
  const unlinkDesignMutation = useUnlinkProductDesign()

  const {
    product,
    isPending: isLoading,
    isError,
    error,
  } = useProduct(
    data.id!,
    {
      fields: "+designs.*",
    },
  ) as {
    product?: ProductWithDesigns
    isPending: boolean
    isError: boolean
    error?: Error
  }

  const handleUnlinkDesign = async (designId: string, designName: string) => {
    if (!designId) return 
    const confirmed = await prompt({
      title: "Unlink Design",
      description: `Are you sure you want to unlink "${designName}" from this product? This action can be undone later.`,
    })

    if (!confirmed) {
      return
    }

    try {
      await unlinkDesignMutation.mutateAsync({
        productId: data.id!,
        payload: { designId }
      })
    } catch (error) {
      // Error handling is done in the mutation
    }
  }

  const getDesignActionGroups = (design: Design) => [
    {
      actions: [
        {
          label: "View Design",
          icon: <PencilSquare />,
          to: `/designs/${design.id}`,
        },
      ],
    },
    {
      actions: [
        {
          label: "Unlink",
          icon: <Trash />,
          variant: "danger" as const,
          onClick: () => handleUnlinkDesign(design.id, design.name),
        },
      ],
    },
  ]

  // Removed unused variable shouldShowAddAction

  if (isLoading) {
    return (
      <Skeleton className="h-32"></Skeleton>
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
          <Heading level="h2">Linked Designs</Heading>
          {product?.designs && product.designs.length > 0 && (
            <Badge size="2xsmall" color="blue">
              {product.designs.length} design{product.designs.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: "Link Design",
                  icon: <Plus />,
                  to: `link-design`,
                },
              ],
            },
          ]}
        />
      </div>

      <div className="p-0">
        {!product?.designs || product.designs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32">
            <p className="text-ui-fg-subtle mb-4">No designs linked yet</p>
            <Button
              variant="secondary"
              onClick={() => navigate(`/products/${data.id}/link-design`)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Link Design
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {product.designs.map((design: Design) => (
              <div key={design.id} className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-x-4">
                  <div className="flex flex-col">
                    <Text size="small" weight="plus" className="mb-1">
                      {design.name}
                    </Text>
                    {design.description && (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {design.description}
                      </Text>
                    )}
                    <div className="flex items-center gap-x-2 mt-2">
                      <StatusBadge color={designStatusColor(design.status)}>
                        {design.status}
                      </StatusBadge>
                      <Badge size="2xsmall" color="grey">
                        {design.design_type}
                      </Badge>
                      <Badge size="2xsmall" color="purple">
                        {design.priority}
                      </Badge>
                    </div>
                  </div>
                </div>
                <ActionMenu groups={getDesignActionGroups(design)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.before",
})

export default ProductDesignsWidget
