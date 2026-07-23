import { listProducts } from "@lib/data/products"
import { retrieveCustomer } from "@lib/data/customer"
import { getDesign, DesignDetail } from "@lib/data/designs"
import DesignEditorWrapper from "@modules/products/components/design-editor/client-wrapper"
import { Metadata } from "next"
import { notFound } from "next/navigation"
import { getRegion } from "@lib/data/regions"

type PageParams = { handle: string; countryCode: string }
type SearchParams = { designId?: string }

type Props = {
  params: Promise<PageParams>
  searchParams: Promise<SearchParams>
}

async function getProduct(params: PageParams) {
  const region = await getRegion(params.countryCode)
  if (!region) return null

  const { response } = await listProducts({
    countryCode: params.countryCode,
    queryParams: { handle: params.handle },
  })

  const product = response.products[0]

  return product || null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolvedParams = await params
  const product = await getProduct(resolvedParams)

  if (!product) {
    return { title: "Design Not Found" }
  }

  return {
    title: `Design ${product.title}`,
    description: `Create a custom design for ${product.title}.`,
  }
}

export default async function DesignPage({
  params,
  searchParams,
}: Props) {
  const [resolvedParams, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ])

  const product = await getProduct(resolvedParams)
  const customer = await retrieveCustomer().catch(() => null)

  if (!product) {
    notFound()
  }

  // If a designId is provided, fetch the existing design to pre-populate the editor
  let initialDesign: DesignDetail | null = null
  if (resolvedSearchParams.designId) {
    initialDesign = await getDesign(resolvedSearchParams.designId).catch(() => null)
  }

  return (
    <DesignEditorWrapper
      product={{
        id: product.id,
        handle: product.handle,
        title: product.title,
        thumbnail: product.thumbnail || undefined,
        description: product.description || undefined,
        designs: (product as any).designs || [],
        metadata: product.metadata || {},
        images: product.images?.map((i: any) => i.url) ?? [],
      }}
      customer={customer ? {
        id: customer.id,
        email: customer.email,
        aiFeaturesPaid: customer.metadata?.ai_features_paid === true,
      } : null}
      countryCode={resolvedParams.countryCode}
      initialDesign={initialDesign}
    />
  )
}
