import { ArrowUpTray, PencilSquare } from "@medusajs/icons"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { ActionMenu } from "../common/action-menu"
import { AdminForm } from "../../hooks/api/forms"

type Segment = {
  id: string
  title?: string
  description?: string | null
  duration_minutes?: number | null
  time_slot?: string | null
  base_price?: number
  currency?: string
  required?: boolean
  image_url?: string | null
}

type Pricing = {
  currency?: string
  per_category_multiplier?: Record<string, number>
}

const formatMoney = (n: number | undefined, currency: string | undefined) => {
  if (typeof n !== "number") return "-"
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${currency || ""} ${n}`
  }
}

type TourSettingsSectionProps = {
  form: AdminForm
}

export const TourSettingsSection = ({ form }: TourSettingsSectionProps) => {
  if (form.type !== "tour") return null

  const settings = (form.settings as Record<string, any> | null) || {}
  const segments: Segment[] = Array.isArray(settings.itinerary_segments)
    ? settings.itinerary_segments
    : []
  const pricing: Pricing = (settings.pricing as Pricing) || {}
  const multiplier = pricing.per_category_multiplier || {}
  const fallbackCurrency = pricing.currency || segments[0]?.currency || "INR"
  const story = (settings.story as { headline?: string; body?: string } | null) || null
  const guides = Array.isArray(settings.guides) ? settings.guides : []

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col">
          <Heading level="h2">Tour settings</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Itinerary segments and pricing rules used by the public visit page.
          </Text>
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  icon: <PencilSquare />,
                  label: "Edit tour settings",
                  to: "tour-settings",
                },
                {
                  icon: <ArrowUpTray />,
                  label: "Import bookings (xlsx)",
                  to: "import-bookings",
                },
              ],
            },
          ]}
        />
      </div>

      {story?.headline || story?.body ? (
        <div className="px-6 py-4">
          <Text size="small" weight="plus" className="block">
            About this tour
          </Text>
          {story.headline ? (
            <Text size="small" className="mt-1 text-ui-fg-subtle">
              {story.headline}
            </Text>
          ) : null}
          {story.body ? (
            <Text size="xsmall" className="mt-1 line-clamp-2 text-ui-fg-subtle">
              {story.body}
            </Text>
          ) : null}
        </div>
      ) : null}

      <div className="px-6 py-4">
        <Text size="small" weight="plus" className="block">
          Guides ({guides.length})
        </Text>
        {guides.length === 0 ? (
          <Text size="xsmall" className="text-ui-fg-subtle">
            None — add guides via &quot;Edit tour settings&quot;.
          </Text>
        ) : (
          <Text size="xsmall" className="text-ui-fg-subtle">
            {guides.map((g: any) => g.name).filter(Boolean).join(" · ")}
          </Text>
        )}
      </div>

      <div className="px-6 py-4">
        <div className="mb-3 flex items-center justify-between">
          <Text size="small" weight="plus">
            Itinerary segments ({segments.length})
          </Text>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Currency: {fallbackCurrency}
          </Text>
        </div>
        {segments.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No segments yet — click &quot;Edit tour settings&quot; to add some.
          </Text>
        ) : (
          <ul className="divide-y rounded-md border">
            {segments.map((s, idx) => (
              <li
                key={s.id || idx}
                className="flex items-start justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Text size="small" weight="plus" className="truncate">
                      {s.title || s.id}
                    </Text>
                    {s.required ? (
                      <Badge size="2xsmall" color="green">Required</Badge>
                    ) : (
                      <Badge size="2xsmall" color="grey">Optional</Badge>
                    )}
                  </div>
                  <Text size="xsmall" className="text-ui-fg-subtle truncate">
                    {s.id}
                    {s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}
                    {s.time_slot ? ` · ${s.time_slot}` : ""}
                  </Text>
                  {s.description ? (
                    <Text size="xsmall" className="text-ui-fg-subtle line-clamp-2 mt-1">
                      {s.description}
                    </Text>
                  ) : null}
                </div>
                <div className="text-right whitespace-nowrap">
                  <Text size="small" weight="plus">
                    {formatMoney(s.base_price, s.currency || fallbackCurrency)}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    per pax
                  </Text>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {Object.keys(multiplier).length > 0 ? (
        <div className="px-6 py-4">
          <Text size="small" weight="plus" className="mb-2 block">
            Per-category multiplier
          </Text>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {Object.entries(multiplier).map(([cat, m]) => (
              <div key={cat} className="flex items-center justify-between">
                <Text size="xsmall" className="text-ui-fg-subtle truncate">
                  {cat}
                </Text>
                <Text size="xsmall">{m}×</Text>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Container>
  )
}
