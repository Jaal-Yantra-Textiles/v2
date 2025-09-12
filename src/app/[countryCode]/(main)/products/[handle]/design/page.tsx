import { listProducts } from "@lib/data/products"
import DesignEditorForm from "@modules/products/components/design-editor-form"
import Image from "next/image"
import { Metadata } from "next"
import { notFound } from "next/navigation"
import { getRegion } from "@lib/data/regions"

export async function generateMetadata({ params }: { params: { handle: string, countryCode: string } }): Promise<Metadata> {
  const { response } = await listProducts({ queryParams: { handle: params.handle }, countryCode: params.countryCode })
  const product = response.products[0]

  if (!product) {
    notFound()
  }

  return {
    title: `Design ${product.title}`,
    description: `Create a custom design for ${product.title}.`,
  }
}

export default async function DesignPage({ params }: { params: { handle: string, countryCode: string } }) {
  const region = await getRegion(params.countryCode)
  if (!region) {
    notFound()
  }
  const product = await listProducts({
    countryCode: params.countryCode,
    queryParams: { handle: params.handle },
  }).then(({ response }) => response.products[0])

  if (!product) {
    notFound()
  }

  return (
    <div className="min-h-screen">
      <DesignEditorForm product={{ title: product.title, thumbnail: product.thumbnail || undefined }} />
    </div>
  )
}
