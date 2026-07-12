import { Metadata } from "next"
import { notFound } from "next/navigation"
import { retrievePreviewProduct } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import ProductTemplate from "@modules/products/templates"
import { HttpTypes } from "@medusajs/types"

// #859 — private artisan product review page.
//
// Fully dynamic (no generateStaticParams), never cached, and NOINDEX. The only
// way in is a valid signed share token; the product is unpublished so it appears
// in no listing, sitemap or search. Lets an artisan share a "review before it
// goes live" link on the core cicilabel.com storefront.
export const dynamic = "force-dynamic"

type Props = {
  params: Promise<{ countryCode: string; token: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Product preview",
    robots: { index: false, follow: false },
  }
}

export default async function ProductPreviewPage(props: Props) {
  const { countryCode, token } = await props.params

  const region = await getRegion(countryCode)
  if (!region) {
    notFound()
  }

  const product = await retrievePreviewProduct({ token, countryCode })
  if (!product) {
    notFound()
  }

  const images: HttpTypes.StoreProductImage[] = product.images ?? []

  return (
    <>
      <PreviewBanner status={(product as any).status} />
      <ProductTemplate
        product={product}
        region={region}
        countryCode={countryCode}
        images={images}
      />
    </>
  )
}

function PreviewBanner({ status }: { status?: string }) {
  const isPending = status === "proposed"
  return (
    <div className="w-full bg-ui-bg-highlight border-b border-ui-border-base">
      <div className="content-container flex flex-col gap-y-0.5 py-3">
        <p className="text-small-semi text-ui-fg-base">
          Private preview — not yet live
        </p>
        <p className="text-small-regular text-ui-fg-subtle">
          {isPending
            ? "This product is awaiting review. Only people with this link can see it, and it won't appear in the store until it's approved and published."
            : "This is a private preview link. This product isn't published, so it won't appear in the store or search."}
        </p>
      </div>
    </div>
  )
}
