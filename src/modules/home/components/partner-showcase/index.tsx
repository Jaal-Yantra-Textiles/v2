import { getPartnerShowcase, ShowcasePartner } from "@lib/data/partner-showcase"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { Text } from "@medusajs/ui"

function formatPrice(price: { amount: number; currency_code: string } | null) {
  if (!price) return null
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency_code.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(price.amount)
}

function PartnerCard({ partner }: { partner: ShowcasePartner }) {
  return (
    <div className="flex flex-col gap-y-4 rounded-xl border border-neutral-200 bg-white p-6">
      {/* Partner header */}
      <div className="flex items-center gap-x-3">
        {partner.logo ? (
          <img
            src={partner.logo}
            alt={partner.name}
            className="h-10 w-10 rounded-full object-cover border border-neutral-100"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-sm font-medium text-neutral-600">
            {partner.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Text className="font-medium truncate">{partner.name}</Text>
          <Text className="text-neutral-500 text-xs">
            {partner.product_count} product{partner.product_count !== 1 ? "s" : ""}
            {partner.categories.length > 0 &&
              ` · ${partner.categories.map((c) => c.name).join(", ")}`}
          </Text>
        </div>
        {partner.storefront_url && (
          <a
            href={partner.storefront_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            Visit Store
          </a>
        )}
      </div>

      {/* Product grid */}
      {partner.featured_products.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {partner.featured_products.map((product) => (
            <LocalizedClientLink
              key={product.id}
              href={`/products/${product.handle}`}
              className="group flex flex-col gap-y-1.5"
            >
              <div className="aspect-square overflow-hidden rounded-lg bg-neutral-100">
                {product.thumbnail ? (
                  <img
                    src={product.thumbnail}
                    alt={product.title}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-neutral-400">
                    <svg
                      className="h-8 w-8"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                      />
                    </svg>
                  </div>
                )}
              </div>
              <Text className="text-xs font-medium truncate">
                {product.title}
              </Text>
              {product.price && (
                <Text className="text-xs text-neutral-500">
                  {formatPrice(product.price)}
                </Text>
              )}
            </LocalizedClientLink>
          ))}
        </div>
      )}

      {/* Collections tags */}
      {partner.collections.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {partner.collections.map((col) => (
            <LocalizedClientLink
              key={col.id}
              href={`/collections/${col.handle}`}
              className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200 transition-colors"
            >
              {col.title}
            </LocalizedClientLink>
          ))}
        </div>
      )}
    </div>
  )
}

export default async function PartnerShowcase() {
  const { partners } = await getPartnerShowcase()

  if (!partners.length) return null

  return (
    <div className="content-container py-16">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-medium tracking-tight">
          Shop from Our Partners
        </h2>
        <p className="mt-2 text-neutral-500">
          Discover unique products from our network of artisan partners
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {partners.map((partner) => (
          <PartnerCard key={partner.id} partner={partner} />
        ))}
      </div>
    </div>
  )
}
