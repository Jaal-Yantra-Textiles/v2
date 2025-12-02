import { listProducts } from "@lib/data/products"
import DesignEditorWrapper from "@modules/products/components/design-editor/client-wrapper"
import { Metadata } from "next"
import { notFound } from "next/navigation"
import { getRegion } from "@lib/data/regions"

type PageParams = { handle: string; countryCode: string }

async function getProduct(params: PageParams) {
  const region = await getRegion(params.countryCode)
  if (!region) return null

  const { response } = await listProducts({
    countryCode: params.countryCode,
    queryParams: { handle: params.handle },
  })
  
  const product = response.products[0]
  console.log("[DesignPage] Product fetched:", product?.id, "thumbnail:", product?.thumbnail)
  
  return product || null
}

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const product = await getProduct(params)

  if (!product) {
    return { title: "Design Not Found" }
  }

  return {
    title: `Design ${product.title}`,
    description: `Create a custom design for ${product.title}.`,
  }
}

export default async function DesignPage({ params }: { params: PageParams }) {
  const product = await getProduct(params)

  if (!product) {
    notFound()
  }

  return (
    <DesignEditorWrapper
      product={{
        id: product.id,
        handle: product.handle,
        title: product.title,
        thumbnail: product.thumbnail || undefined,
      }}
    />
  )
}
