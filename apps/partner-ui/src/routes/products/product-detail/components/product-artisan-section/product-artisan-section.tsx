import { HttpTypes } from "@medusajs/types"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

import {
  useArtisanProductDetail,
  useUpsertArtisanProductDetail,
} from "../../../../../hooks/api/products"
import { usePartnerOnboardingProfile } from "../../../../../hooks/api/onboarding-profile"

type Props = {
  product: HttpTypes.AdminProduct
}

/**
 * #859 S3 (#862) — the partner-editable "Made-to-order & maker story" panel.
 *
 * These fields are stored on the linked `artisan_product_detail` module (not
 * product metadata) and surfaced on the storefront: a made-to-order notice with
 * lead time, a minimum order quantity enforced at add-to-cart, and the maker /
 * provenance prose shown on the product page.
 */
export const ProductArtisanSection = ({ product }: Props) => {
  // #859 S3 — this panel only applies to artisans selling on the core channel.
  const { onboarding_profile } = usePartnerOnboardingProfile()
  const isCoreListing =
    onboarding_profile?.selling_mode === "core_channel_listing"

  const { artisan_detail, isLoading } = useArtisanProductDetail(product.id, {
    enabled: isCoreListing,
  })
  const { mutateAsync, isPending } = useUpsertArtisanProductDetail(product.id)

  const [madeToOrder, setMadeToOrder] = useState(false)
  const [leadTimeDays, setLeadTimeDays] = useState<string>("")
  const [leadTimeLabel, setLeadTimeLabel] = useState<string>("")
  const [minOrderQty, setMinOrderQty] = useState<string>("")
  const [makerStory, setMakerStory] = useState<string>("")

  // Hydrate once the saved detail loads.
  useEffect(() => {
    if (!artisan_detail) return
    setMadeToOrder(!!artisan_detail.made_to_order)
    setLeadTimeDays(
      artisan_detail.lead_time_days != null
        ? String(artisan_detail.lead_time_days)
        : ""
    )
    setLeadTimeLabel(artisan_detail.lead_time_label ?? "")
    setMinOrderQty(
      artisan_detail.min_order_quantity != null
        ? String(artisan_detail.min_order_quantity)
        : ""
    )
    setMakerStory(artisan_detail.maker_story ?? "")
  }, [artisan_detail])

  const handleSave = async () => {
    // Empty numeric/text inputs clear the field (null); otherwise parse/trim.
    const payload = {
      made_to_order: madeToOrder,
      lead_time_days: leadTimeDays.trim() === "" ? null : Number(leadTimeDays),
      lead_time_label: leadTimeLabel.trim() === "" ? null : leadTimeLabel.trim(),
      min_order_quantity:
        minOrderQty.trim() === "" ? null : Number(minOrderQty),
      maker_story: makerStory.trim() === "" ? null : makerStory.trim(),
    }

    if (
      payload.lead_time_days != null &&
      (!Number.isFinite(payload.lead_time_days) || payload.lead_time_days < 0)
    ) {
      toast.error("Lead time must be a positive number of days")
      return
    }
    if (
      payload.min_order_quantity != null &&
      (!Number.isFinite(payload.min_order_quantity) ||
        payload.min_order_quantity < 1)
    ) {
      toast.error("Minimum order quantity must be at least 1")
      return
    }

    await mutateAsync(payload, {
      onSuccess: () => toast.success("Made-to-order details saved"),
      onError: (e) => toast.error(e.message),
    })
  }

  // Hidden for dedicated-storefront partners — the made-to-order / maker-story
  // fields only surface on the core-channel (Airbnb-style) listings.
  if (!isCoreListing) {
    return null
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Made-to-order & maker story</Heading>
      </div>

      <div className="flex flex-col gap-y-4 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <Label htmlFor="made_to_order" weight="plus">
              Made to order
            </Label>
            <Text size="small" className="text-ui-fg-subtle">
              Crafted on demand after the customer orders.
            </Text>
          </div>
          <Switch
            id="made_to_order"
            checked={madeToOrder}
            onCheckedChange={setMadeToOrder}
            disabled={isLoading}
          />
        </div>

        <div className="flex flex-col gap-y-2">
          <Label htmlFor="lead_time_label" weight="plus">
            Lead time note
          </Label>
          <Input
            id="lead_time_label"
            placeholder="e.g. takes a few weeks"
            value={leadTimeLabel}
            onChange={(e) => setLeadTimeLabel(e.target.value)}
            disabled={isLoading}
          />
          <Text size="small" className="text-ui-fg-subtle">
            Shown to shoppers as-is. Leave empty to derive it from the days
            below.
          </Text>
        </div>

        <div className="flex flex-col gap-y-2">
          <Label htmlFor="lead_time_days" weight="plus">
            Lead time (days)
          </Label>
          <Input
            id="lead_time_days"
            type="number"
            min={0}
            placeholder="e.g. 21"
            value={leadTimeDays}
            onChange={(e) => setLeadTimeDays(e.target.value)}
            disabled={isLoading}
          />
          <Text size="small" className="text-ui-fg-subtle">
            Rendered as an approximate "~N weeks to prepare" when no note is set.
          </Text>
        </div>

        <div className="flex flex-col gap-y-2">
          <Label htmlFor="min_order_quantity" weight="plus">
            Minimum order quantity
          </Label>
          <Input
            id="min_order_quantity"
            type="number"
            min={1}
            placeholder="e.g. 1"
            value={minOrderQty}
            onChange={(e) => setMinOrderQty(e.target.value)}
            disabled={isLoading}
          />
        </div>

        <div className="flex flex-col gap-y-2">
          <Label htmlFor="maker_story" weight="plus">
            Maker's story
          </Label>
          <Textarea
            id="maker_story"
            rows={5}
            placeholder="Who makes this, where, and how it's crafted…"
            value={makerStory}
            onChange={(e) => setMakerStory(e.target.value)}
            disabled={isLoading}
          />
        </div>

        <div className="flex justify-end">
          <Button
            variant="primary"
            size="small"
            onClick={handleSave}
            isLoading={isPending}
            disabled={isLoading}
          >
            Save
          </Button>
        </div>
      </div>
    </Container>
  )
}
