import { HttpTypes } from "@medusajs/types"
import { PencilSquare } from "@medusajs/icons"
import { Badge, Container, Heading, Text } from "@medusajs/ui"

import { ActionMenu } from "../../../../../components/common/action-menu"
import { SectionRow } from "../../../../../components/common/section"
import { Skeleton } from "../../../../../components/common/skeleton"
import {
  useProductSpec,
  useWeaveCatalog,
  type ProductSpecColor,
  type ProductSpecField,
  type WeaveTechnique,
} from "../../../../../hooks/api/products"

type Props = {
  product: HttpTypes.AdminProduct
}

/**
 * #1342 / #1349 — the partner-authored production spec, as READ-ONLY content.
 *
 * This section used to host the editor inline. It now shows what was written
 * and sends the partner to `spec/edit` (a focus modal) to change it, matching
 * every other section on this page: detail pages read, modals write. The
 * previous arrangement put a five-part form in the middle of the main column,
 * so the sections a partner touches daily sat below a form most products never
 * use.
 */

/** A stored param key rendered with the label + unit the catalog defines for
 *  it. Falls back to the raw key so a param whose technique was later renamed
 *  still shows its value rather than vanishing. */
const paramRows = (
  params: Record<string, number> | null | undefined,
  technique?: WeaveTechnique
) => {
  const entries = Object.entries(params ?? {})
  if (!entries.length) {
    return []
  }

  return entries.map(([key, value]) => {
    const def = technique?.params.find((p) => p.key === key)
    return {
      key,
      label: def?.label ?? key,
      value: def?.unit ? `${value} ${def.unit}` : `${value}`,
    }
  })
}

const ColorSwatches = ({ colors }: { colors: ProductSpecColor[] }) => (
  <div className="flex flex-wrap items-center gap-2">
    {colors.map((color) => (
      <div
        key={color.id ?? color.name}
        className="border-ui-border-base bg-ui-bg-subtle flex items-center gap-x-2 rounded-full border py-1 pl-1 pr-3"
      >
        <span
          className="border-ui-border-base size-5 rounded-full border"
          style={{ backgroundColor: color.hex_code ?? "transparent" }}
          // The swatch is decorative; the name beside it carries the meaning.
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
  </div>
)

const CustomFields = ({ fields }: { fields: ProductSpecField[] }) => (
  <div className="flex flex-col">
    {fields.map((field) => (
      <SectionRow
        key={field.id ?? field.key}
        title={field.label?.trim() || field.key}
        value={field.value ?? "-"}
      />
    ))}
  </div>
)

export const ProductSpecSection = ({ product }: Props) => {
  const { spec, isLoading } = useProductSpec(product.id)
  const { techniques, isLoading: catalogLoading } = useWeaveCatalog()

  const technique = techniques?.find((t) => t.slug === spec?.weave_technique)
  const colors = (spec?.colors ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const fields = (spec?.fields ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const params = paramRows(spec?.params, technique)
  const finishes = spec?.finishes ?? []

  // A spec row can exist with nothing but defaults on it, so "has a spec" is
  // decided by whether anything was actually written — not by the row.
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
            The weave, colours and specs you&apos;ll make this to — agreed
            before you take a custom order.
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
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: hasContent ? "Edit" : "Add spec",
                    to: "spec/edit",
                    icon: <PencilSquare />,
                  },
                ],
              },
            ]}
          />
        </div>
      </div>

      {isLoading || catalogLoading ? (
        <div className="flex flex-col gap-y-2 px-6 py-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : !hasContent ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            No production spec yet. Add one so buyers — and anyone quoting a
            custom order — can see what this is made to.
          </Text>
        </div>
      ) : (
        <>
          <SectionRow
            title="Weave"
            value={technique?.label ?? spec?.weave_technique ?? "-"}
          />
          {spec?.weave_label && (
            <SectionRow title="Weave name" value={spec.weave_label} />
          )}
          {params.map((param) => (
            <SectionRow
              key={param.key}
              title={param.label}
              value={param.value}
            />
          ))}
          {!!finishes.length && (
            <SectionRow
              title="Finishes"
              value={finishes.map((finish) => (
                <Badge key={finish} size="2xsmall">
                  {finish}
                </Badge>
              ))}
            />
          )}
          {!!colors.length && (
            <SectionRow
              title="Palette"
              value={<ColorSwatches colors={colors} />}
            />
          )}
          {spec?.notes && <SectionRow title="Notes" value={spec.notes} />}
          {!!fields.length && <CustomFields fields={fields} />}
        </>
      )}
    </Container>
  )
}
