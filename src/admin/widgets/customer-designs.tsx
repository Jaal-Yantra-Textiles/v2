import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Badge, StatusBadge, Skeleton, Heading, Button } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { useNavigate } from "react-router-dom"
import { ActionMenu } from "../components/common/action-menu"
import { PencilSquare, Plus } from "@medusajs/icons"
import { useDesigns } from "../hooks/api/designs"

const designStatusColor = (status: string): "green" | "blue" | "orange" | "grey" | "red" | "purple" => {
  switch (status) {
    case "Commerce_Ready": return "green"
    case "Approved": return "blue"
    case "In_Development": return "orange"
    case "Conceptual": return "grey"
    case "Rejected": return "red"
    case "On_Hold": return "purple"
    default: return "grey"
  }
}

type Customer = { id: string }

const CustomerDesignsWidget = ({ data }: DetailWidgetProps<Customer>) => {
  const navigate = useNavigate()

  const { designs, isLoading, isError, error } = useDesigns({ customer_id: data.id } as any)

  const getDesignActionGroups = (design: any) => [
    {
      actions: [
        {
          label: "View Design",
          icon: <PencilSquare />,
          to: `/designs/${design.id}`,
        },
        {
          label: "Open Moodboard",
          icon: <PencilSquare />,
          to: `/designs/${design.id}/moodboard`,
        },
      ],
    },
  ]

  if (isLoading) {
    return <Skeleton className="h-32" />
  }

  if (isError) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-center h-40">
          <Text className="text-ui-fg-error">{(error as any)?.message || "An error occurred"}</Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading level="h2">Customer Designs</Heading>
          {designs.length > 0 && (
            <Badge size="2xsmall" color="blue">
              {designs.length} design{designs.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <Button
          variant="secondary"
          size="small"
          onClick={() => navigate("/designs/create", { state: { customer_id: data.id } })}
        >
          <Plus className="w-4 h-4 mr-1" />
          Create Design
        </Button>
      </div>

      <div className="p-0">
        {designs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32">
            <p className="text-ui-fg-subtle mb-4">No designs for this customer yet</p>
            <Button
              variant="secondary"
              onClick={() => navigate("/designs/create", { state: { customer_id: data.id } })}
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Design
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {designs.map((design: any) => (
              <div key={design.id} className="flex items-center justify-between px-6 py-4">
                <div className="flex flex-col">
                  <Text size="small" weight="plus" className="mb-1">
                    {design.name}
                  </Text>
                  {design.description && (
                    <Text size="xsmall" className="text-ui-fg-subtle line-clamp-1">
                      {design.description}
                    </Text>
                  )}
                  <div className="flex items-center gap-x-2 mt-2">
                    {design.status && (
                      <StatusBadge color={designStatusColor(design.status)}>
                        {design.status}
                      </StatusBadge>
                    )}
                    {design.design_type && (
                      <Badge size="2xsmall" color="grey">
                        {design.design_type}
                      </Badge>
                    )}
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
  zone: "customer.details.side.before",
})

export default CustomerDesignsWidget
