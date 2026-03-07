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

const OrderDesignWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ design: DesignType | null }>(
        `/admin/orders/${order.id}/design`,
        { method: "GET" }
      ),
    queryKey: ["order-design", order.id],
  })

  const { mutateAsync: approve, isPending } = useMutation({
    mutationFn: (designId: string) =>
      sdk.client.fetch(`/admin/designs/${designId}/approve`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-design", order.id] })
      toast.success("Design approved")
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to approve design")
    },
  })

  const design = data?.design

  if (!isLoading && !design) return null

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4 flex items-center justify-between">
        <Heading level="h2">Custom Design</Heading>
        {design && (
          <Badge color={getStatusColor(design.status)}>{design.status}</Badge>
        )}
      </div>
      {isLoading && <Skeleton className="h-32 mx-6 my-4" />}
      {design && (
        <div className="px-6 py-4 space-y-3">
          {design.thumbnail_url && (
            <img
              src={design.thumbnail_url}
              alt={design.name}
              className="w-full rounded-lg object-cover"
            />
          )}
          <Text weight="plus">{design.name}</Text>
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
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.before",
})

export default OrderDesignWidget
