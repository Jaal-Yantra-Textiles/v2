import { Metadata } from "next"
import { notFound } from "next/navigation"

import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { getProductSpec } from "@lib/data/product-spec"
import CustomiseForm from "@modules/products/templates/customise/customise-form"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

// Same reason as the product page: cookies() in getRegion/getCacheOptions
// makes ISR throw DYNAMIC_SERVER_USAGE.
export const dynamic = "force-dynamic"

type Props = {
  params: Promise<{ countryCode: string; handle: string }>
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { handle, countryCode } = await props.params
  const product = await listProducts({
    countryCode,
    queryParams: { handle },
  }).then(({ response }) => response.products[0])

  if (!product) {
    notFound()
  }

  return {
    title: `Customise ${product.title}`,
    description: `Choose the colour and finishing for your ${product.title}, woven to order.`,
    // A configurator is a step in a purchase, not a page anyone should land on
    // from search — and an indexed copy would compete with the product itself.
    robots: { index: false, follow: true },
  }
}

export default async function CustomiseProductPage(props: Props) {
  const params = await props.params
  const region = await getRegion(params.countryCode)

  if (!region) {
    notFound()
  }

  const product = await listProducts({
    countryCode: params.countryCode,
    queryParams: {
      handle: params.handle,
      // `images` is NOT in the shared field selection — the product page gets
      // its gallery from a separate call. This page pins the image beside the
      // choices, so it has to ask for it; without this the configurator renders
      // with an empty frame and nothing says why.
      fields: "*images,*variants.calculated_price",
    },
  }).then(({ response }) => response.products[0])

  if (!product) {
    notFound()
  }

  const { spec } = await getProductSpec(product.id)

  // A product with no spec, or one whose partner has stopped taking the work,
  // has nothing to configure. 404 rather than an empty configurator — the page
  // genuinely does not exist for this product.
  if (!spec?.accepting_custom_orders) {
    notFound()
  }

  return (
    <>
      <nav
        aria-label="Breadcrumb"
        className="content-container pt-4 text-ui-fg-subtle txt-compact-small"
      >
        <LocalizedClientLink
          href={`/products/${params.handle}`}
          className="hover:text-ui-fg-base"
          data-testid="customise-back"
        >
          &larr; Back to {product.title}
        </LocalizedClientLink>
      </nav>
      <CustomiseForm
        product={product}
        spec={spec}
        images={product.images ?? []}
      />
    </>
  )
}
