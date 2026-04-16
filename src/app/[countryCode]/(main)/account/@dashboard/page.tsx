import { Metadata } from "next"

import Overview from "@modules/account/components/overview"
import { notFound } from "next/navigation"
import { retrieveCustomer } from "@lib/data/customer"
import { listOrders } from "@lib/data/orders"
import { listDesigns } from "@lib/data/designs"

export const metadata: Metadata = {
  title: "Account",
  description: "Overview of your account activity.",
}

export default async function OverviewTemplate() {
  const customer = await retrieveCustomer().catch(() => null)

  if (!customer) {
    notFound()
  }

  const [orders, { designs }] = await Promise.all([
    listOrders().catch(() => null),
    listDesigns({ limit: 5 }).catch(() => ({ designs: [] as any[] })),
  ])

  return <Overview customer={customer} orders={orders} designs={designs} />
}
