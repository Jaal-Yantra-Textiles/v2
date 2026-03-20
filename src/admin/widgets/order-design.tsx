import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Badge, Heading, Button, Skeleton, toast } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../lib/config"

type DesignType = {
  id: string
  name: string
  status: string
  description?: string
  thumbnail_url?: string
  estimated_cost?: number
}

type AdminOrder = {
  id: string
}

const getStatusColor = (status: string): "green" | "blue" | "orange" | "grey" | "red" | "purple" => {
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

const DesignCard = ({
  design,
  orderId,
}: {
  design: DesignType
  orderId: string
}) => {
  const queryClient = useQueryClient()

  const { mutateAsync: approve, isPending } = useMutation({
    mutationFn: (designId: string) =>
      sdk.client.fetch(`/admin/designs/${designId}/approve`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-design", orderId] })
      toast.success("Design approved")
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to approve design")
    },
  })

  return (
    <div className="px-6 py-4 space-y-3">
      {design.thumbnail_url && (
        <img
          src={design.thumbnail_url}
          alt={design.name}
          className="w-full rounded-lg object-cover"
        />
      )}
      <div className="flex items-center justify-between">
        <Text weight="plus">{design.name}</Text>
        <Badge color={getStatusColor(design.status)}>{design.status}</Badge>
      </div>
      {design.description && (
        <Text className="text-ui-fg-subtle">{design.description}</Text>
      )}
      {design.estimated_cost != null && (
        <Text>Est. cost: ${design.estimated_cost}</Text>
      )}
      <Button
        size="small"
        disabled={design.status === "Approved" || isPending}
        onClick={() => approve(design.id)}
      >
        {design.status === "Approved" ? "Approved ✓" : "Approve Design"}
      </Button>
    </div>
  )
}

const OrderDesignWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const { data, isLoading } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ design: DesignType | null; designs: DesignType[] }>(
        `/admin/orders/${order.id}/design`,
        { method: "GET" }
      ),
    queryKey: ["order-design", order.id],
  })

  const designs = data?.designs || (data?.design ? [data.design] : [])

  if (!isLoading && designs.length === 0) return null

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4 flex items-center justify-between">
        <Heading level="h2">Custom Designs</Heading>
        {designs.length > 1 && (
          <Badge size="2xsmall" color="blue">
            {designs.length}
          </Badge>
        )}
      </div>
      {isLoading && <Skeleton className="h-32 mx-6 my-4" />}
      {designs.length > 0 && (
        <div className="divide-y">
          {designs.map((design) => (
            <DesignCard key={design.id} design={design} orderId={order.id} />
          ))}
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.before",
})

export default OrderDesignWidget
