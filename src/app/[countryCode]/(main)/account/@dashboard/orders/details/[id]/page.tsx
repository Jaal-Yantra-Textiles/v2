import { retrieveOrder, listReturnShippingOptions } from "@lib/data/orders"
import OrderDetailsTemplate from "@modules/order/templates/order-details-template"
import { Metadata } from "next"
import { notFound } from "next/navigation"

type Props = {
  params: Promise<{ id: string }>
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  const order = await retrieveOrder(params.id).catch(() => null)

  if (!order) {
    notFound()
  }

  return {
    title: `Order #${order.display_id}`,
    description: `View your order`,
    robots: { index: false, follow: false },
  }
}

export default async function OrderDetailPage(props: Props) {
  const params = await props.params
  const order = await retrieveOrder(params.id).catch(() => null)

  if (!order) {
    notFound()
  }

  // Fetch return shipping options via the order's linked cart
  const cartId = (order as any).cart?.id
  const returnShippingOptions = cartId
    ? await listReturnShippingOptions(cartId)
    : []

  return (
    <OrderDetailsTemplate
      order={order}
      returnShippingOptions={returnShippingOptions}
    />
  )
}
