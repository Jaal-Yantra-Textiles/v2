import { retrieveCustomer } from "@lib/data/customer"
import { getRegion } from "@lib/data/regions"
import DesignChatWrapper from "@modules/products/components/design-chat/client-wrapper"
import { Metadata } from "next"
import { notFound } from "next/navigation"

type Props = {
  params: Promise<{ countryCode: string }>
}

export const metadata: Metadata = {
  title: "Design",
  description: "Create a custom design.",
}

export default async function DesignPage(props: Props) {
  const params = await props.params

  const region = await getRegion(params.countryCode)

  if (!region) {
    notFound()
  }

  const customer = await retrieveCustomer().catch(() => null)

  // Chat-based design editor — standalone flow (no base product; the design
  // generates from brief + moodboard inspirations).
  void customer
  return (
    <DesignChatWrapper
      product={null}
      initialDesign={null}
      countryCode={params.countryCode}
    />
  )
}
