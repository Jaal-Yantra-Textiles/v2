import { HttpTypes } from "@medusajs/types"
import { Text } from "@medusajs/ui"

import { getProductSpec } from "@lib/data/product-spec"

import MadeToOrderForm from "./made-to-order-form"

/**
 * #1349 — the production spec on the product page.
 *
 * Two things, in this order: what the piece IS made to (weave, measured
 * parameters, finishes, the partner's own specs), and — only when the partner
 * is taking the work — the form to have one made in a colour of the customer's
 * choosing.
 *
 * A server component, so the spec is fetched and cached with the page rather
 * than after it paints. It renders nothing at all when a product has no spec,
 * which is the normal case.
 */

type Props = {
  product: HttpTypes.StoreProduct
}

const ProductionSpec = async ({ product }: Props) => {
  const { spec, technique } = await getProductSpec(product.id)

  if (!spec) {
    return null
  }

  const params = Object.entries(spec.params ?? {}).map(([key, value]) => {
    const def = technique?.params.find((p) => p.key === key)
    return {
      key,
      label: def?.label ?? key,
      value: def?.unit ? `${value} ${def.unit}` : `${value}`,
    }
  })

  const rows = [
    ...(technique?.label || spec.weave_label
      ? [
          {
            key: "weave",
            label: "Weave",
            value: spec.weave_label || technique?.label || "",
          },
        ]
      : []),
    ...params,
    ...(spec.finishes?.length
      ? [
          {
            key: "finishes",
            label: "Finishing & care",
            value: spec.finishes.join(", "),
          },
        ]
      : []),
    ...spec.fields
      .filter((field) => (field.value ?? "").trim())
      .map((field) => ({
        key: field.key,
        label: (field.label ?? field.key).trim(),
        value: (field.value ?? "").trim(),
      })),
  ]

  // A spec row can exist with nothing written on it. Rendering a heading over
  // an empty table would advertise detail the partner never provided.
  if (!rows.length && !spec.accepting_custom_orders) {
    return null
  }

  return (
    <div className="flex flex-col gap-y-6 py-8">
      {!!rows.length && (
        <div className="flex flex-col gap-y-3">
          <Text className="text-ui-fg-base font-medium">Made to</Text>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 small:grid-cols-2">
            {rows.map((row) => (
              <div
                key={row.key}
                className="flex items-baseline justify-between gap-x-4 border-b border-ui-border-base py-2"
              >
                <dt className="text-ui-fg-subtle text-sm">{row.label}</dt>
                <dd className="text-ui-fg-base text-sm text-right">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {technique?.description && (
            <Text size="small" className="text-ui-fg-muted">
              {technique.description}
            </Text>
          )}
        </div>
      )}

      {spec.accepting_custom_orders && (
        <MadeToOrderForm spec={spec} variants={product.variants ?? []} />
      )}
    </div>
  )
}

export default ProductionSpec
