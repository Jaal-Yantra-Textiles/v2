import { retrieveCustomer } from "@lib/data/customer"
import { getRegion } from "@lib/data/regions"
import DesignEditorWrapper from "@modules/products/components/design-editor/client-wrapper"
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

  return (
    <DesignEditorWrapper
      product={{
        id: "custom_design",
        handle: "design",
        title: "Custom Design",
        thumbnail: undefined,
        description: "Create a custom design.",
        designs: [],
        metadata: {},
      }}
      customer={customer ? { id: customer.id, email: customer.email } : null}
      countryCode={params.countryCode}
    />
  )
}
