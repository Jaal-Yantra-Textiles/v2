import { Metadata } from "next"
import { notFound } from "next/navigation"
import { retrievePublicOrder } from "@lib/data/orders"
import OrderDetailsTemplate from "@modules/order/templates/order-details-template"

type Props = {
  params: Promise<{ id: string }>
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  const order = await retrievePublicOrder(params.id)

  if (!order) {
    return { title: "Order not found" }
  }

  return {
    title: `Order #${order.display_id}`,
    description: `Track the status of order #${order.display_id}`,
  }
}

export default async function PublicOrderPage(props: Props) {
  const params = await props.params
  const order = await retrievePublicOrder(params.id)

  if (!order) {
    notFound()
  }

  return (
    <div className="content-container py-6 max-w-4xl mx-auto">
      <OrderDetailsTemplate order={order} isPublic />
    </div>
  )
}
