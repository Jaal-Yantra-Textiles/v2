import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { PencilSquare } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { useNavigate } from "react-router-dom"

import {
  useProductSpec,
  useWeaveCatalog,
  type ProductSpecColor,
  type ProductSpecField,
  type WeaveTechnique,
} from "../hooks/api/product-spec"

/**
 * #1349 — the production spec on the ADMIN product page.
 *
 * Same shape as the partner surface: the widget READS, and a separate route
 * writes. Admins were the one audience with no way to see a spec at all — the
 * data was reachable only through the partner portal or an MCP call, so a
 * support question about what a piece is made to could not be answered from
 * the admin.
 *
 * The editor is a `RouteFocusModal` at `/products/:id/spec`, not a `FocusModal`
 * held open by this widget's own state. A widget is mounted with the product
 * page, and `RouteFocusModal` opens on mount and navigates away on close, so
 * the two cannot be combined — hence the navigate below, which is how
 * `product-designs` opens `link-design` too. A `FocusModal` rather than the
 * `Drawer` the admin guidance prefers for edits: the editor is a five-part form
 * with a parameter grid and a repeatable colour palette, and a drawer's width
 * forces every row to wrap. The rule exists so edits stay in place and
 * lightweight; this edit is neither.
 */

type AdminProduct = { id: string; title?: string }

/** A stored param rendered with the label + unit its technique defines. Falls
 *  back to the raw key so a param whose technique was renamed still shows. */
const paramRows = (
  params: Record<string, number> | null | undefined,
  technique?: WeaveTechnique
) =>
  Object.entries(params ?? {}).map(([key, value]) => {
    const def = technique?.params.find((p) => p.key === key)
    return {
      key,
      label: def?.label ?? key,
      value: def?.unit ? `${value} ${def.unit}` : `${value}`,
    }
  })

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="text-ui-fg-subtle grid w-full grid-cols-1 items-start gap-1 px-6 py-4 sm:grid-cols-2 sm:items-center sm:gap-4">
    <Text size="small" weight="plus" leading="compact">
      {label}
    </Text>
    <div className="flex flex-wrap items-center gap-1">{children}</div>
  </div>
)

const ProductProductionSpecWidget = ({
  data: product,
}: DetailWidgetProps<AdminProduct>) => {
  const navigate = useNavigate()

  const { spec, isLoading } = useProductSpec(product.id)
  const { techniques, isLoading: catalogLoading } = useWeaveCatalog()

  const technique = techniques.find((t) => t.slug === spec?.weave_technique)
  const colors: ProductSpecColor[] = (spec?.colors ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const fields: ProductSpecField[] = (spec?.fields ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const params = paramRows(spec?.params, technique)
  const finishes = spec?.finishes ?? []

  // A spec row can exist carrying nothing but defaults, so "has a spec" is
  // decided by whether anything was written — not by the row existing.
  const hasContent =
    !!spec?.weave_technique ||
    !!spec?.weave_label ||
    !!spec?.notes ||
    !!params.length ||
    !!finishes.length ||
    !!colors.length ||
    !!fields.length

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Production spec</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            The weave, colours and specs this product is made to.
          </Text>
        </div>
        <div className="flex items-center gap-x-2">
          {spec?.accepting_custom_orders && (
            <Badge size="2xsmall" color="green">
              {spec.custom_order_lead_time_days
                ? `Custom orders · ${spec.custom_order_lead_time_days} days`
                : "Custom orders"}
            </Badge>
          )}
          <Button
            size="small"
            variant="secondary"
            onClick={() => navigate(`/products/${product.id}/spec`)}
            disabled={isLoading || catalogLoading}
          >
            <PencilSquare />
            {hasContent ? "Edit" : "Add spec"}
          </Button>
        </div>
      </div>

      {isLoading || catalogLoading ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Loading spec…
          </Text>
        </div>
      ) : !hasContent ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            No production spec has been written for this product.
          </Text>
        </div>
      ) : (
        <>
          <Row label="Weave">
            <Text size="small" leading="compact">
              {technique?.label ?? spec?.weave_technique ?? "-"}
            </Text>
          </Row>
          {spec?.weave_label && (
            <Row label="Weave name">
              <Text size="small" leading="compact">
                {spec.weave_label}
              </Text>
            </Row>
          )}
          {params.map((param) => (
            <Row key={param.key} label={param.label}>
              <Text size="small" leading="compact">
                {param.value}
              </Text>
            </Row>
          ))}
          {!!finishes.length && (
            <Row label="Finishes">
              {finishes.map((finish) => (
                <Badge key={finish} size="2xsmall">
                  {finish}
                </Badge>
              ))}
            </Row>
          )}
          {!!colors.length && (
            <Row label="Palette">
              {colors.map((color) => (
                <div
                  key={color.id ?? color.name}
                  className="border-ui-border-base bg-ui-bg-subtle flex items-center gap-x-2 rounded-full border py-1 pl-1 pr-3"
                >
                  <span
                    className="border-ui-border-base size-5 rounded-full border"
                    style={{ backgroundColor: color.hex_code ?? "transparent" }}
                    aria-hidden
                  />
                  <Text size="small" leading="compact">
                    {color.name}
                  </Text>
                  {color.available === false && (
                    <Badge size="2xsmall" color="grey">
                      Unavailable
                    </Badge>
                  )}
                </div>
              ))}
            </Row>
          )}
          {spec?.notes && (
            <Row label="Notes">
              <Text
                size="small"
                leading="compact"
                className="whitespace-pre-line"
              >
                {spec.notes}
              </Text>
            </Row>
          )}
          {fields.map((field) => (
            <Row
              key={field.id ?? field.key}
              label={field.label?.trim() || field.key}
            >
              <Text size="small" leading="compact">
                {field.value ?? "-"}
              </Text>
            </Row>
          ))}
        </>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductProductionSpecWidget
