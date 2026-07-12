import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  WorkflowData,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"
import type { RemoteQueryFunction } from "@medusajs/types"
import { ETSY_SYNC_MODULE } from "../modules/etsy-sync"
import EtsySyncService from "../modules/etsy-sync/service"
import { EtsyClient } from "../lib/etsy-client"
import {
  CreateListingInput,
  ListingResponse,
  UploadedImage,
} from "../lib/types"

export const SYNC_PRODUCT_TO_ETSY = "etsy-sync-product"

/**
 * A draft Etsy listing has no public `url` (Etsy only mints one once the listing
 * is active). So the admin has "no link to the draft". Fall back to the Shop
 * Manager edit URL, which the authenticated shop owner can open directly.
 */
const listingDisplayUrl = (listing: ListingResponse): string | null => {
  if (listing.url) return listing.url
  if (!listing.listing_id) return null
  return `https://www.etsy.com/your/shops/me/tools/listings/${listing.listing_id}`
}

export type SyncProductToEtsyInput = {
  product_id: string
}

type ResolvedConfig = {
  account_id: string
  shop_id: string
  access_token: string
  currency: string | null
  settings: any
}

type PreparedProduct = {
  product_id: string
  product_title: string
  product_status: string
  listing_input: CreateListingInput
  image_urls: string[]
  existing_listing_id: string | null
}

type SyncResult = {
  listing: ListingResponse
  listing_url: string | null
  uploaded_images: UploadedImage[]
  published: boolean
  warnings: string[]
}

// ── Step 1: resolve account (fresh token) + settings ─────────────────────

const resolveEtsyConfigStep = createStep(
  "etsy-resolve-config-step",
  async (_, { container }): Promise<StepResponse<ResolvedConfig>> => {
    const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)
    const account = await service.ensureFreshToken()
    const settings = await service.getSettings()
    return new StepResponse({
      account_id: account.id,
      shop_id: account.shop_id,
      access_token: account.access_token,
      currency: account.currency ?? null,
      settings,
    })
  }
)

// ── Step 2: fetch + map product ──────────────────────────────────────────

const prepareProductStep = createStep(
  "etsy-prepare-product-step",
  async (
    input: { product_id: string; settings: any; currency: string | null },
    { container }
  ): Promise<StepResponse<PreparedProduct>> => {
    const query = container.resolve(
      ContainerRegistrationKeys.QUERY
    ) as Omit<RemoteQueryFunction, symbol>
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)

    const { data: products } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "description",
        "status",
        "metadata",
        "tags.*",
        "variants.*",
        "variants.prices.*",
        "variants.inventory_items.*",
        "images.*",
      ],
      filters: { id: input.product_id },
    })

    const product: any = products?.[0]
    if (!product) {
      throw new Error(`Product ${input.product_id} not found`)
    }

    // Resolve existing Etsy listing (from link)
    let existing_listing_id: string | null = null
    const account = await service.getActiveAccount()
    if (account) {
      try {
        const linkRows = await remoteLink.list({
          [Modules.PRODUCT]: { product_id: input.product_id },
          [ETSY_SYNC_MODULE]: { etsy_sync_account_id: account.id },
        })
        const row: any = (linkRows as any[])?.[0]
        existing_listing_id = row?.etsy_listing_id ?? null
      } catch {
        // no link yet
      }
    }

    const settings = input.settings
    const metadata = product.metadata || {}
    const variants: any[] = product.variants || []

    // Aggregate quantity across variants
    const quantity = variants.reduce(
      (sum, v) => sum + (Number(v.inventory_quantity) || 0),
      variants.length ? 0 : 1
    ) || 1

    // Etsy prices the listing in the shop's own currency. Medusa v2 stores the
    // money amount as a whole decimal in the price's own currency (e.g. 120.00
    // means 120.00 EUR — NOT minor units), so we pass it through as-is. Dividing
    // by 100 here is what produced the wrong "1.20" draft price.
    const shopCurrency = (input.currency || "").toLowerCase()
    const allPrices = variants.flatMap((v) => v.prices || [])
    // Prefer prices already in the shop currency; fall back to every price only
    // if none match (so a mis-currency listing still gets a sane, non-zero price).
    const currencyPrices = shopCurrency
      ? allPrices.filter(
          (p) => String(p.currency_code || "").toLowerCase() === shopCurrency
        )
      : allPrices
    const priceAmounts = (currencyPrices.length ? currencyPrices : allPrices)
      .map((p) => Number(p.amount))
      .filter((a) => a > 0)
    const minPrice = priceAmounts.length ? Math.min(...priceAmounts) : 0

    const tags = (product.tags || [])
      .map((t: any) => t.value)
      .filter(Boolean)
      .slice(0, 13)

    const image_urls = (product.images || [])
      .map((img: any) => img.url)
      .filter(Boolean)

    const listing_input: CreateListingInput = {
      quantity,
      title: (product.title || "Untitled Product").slice(0, 140),
      description: product.description || "",
      price: minPrice,
      who_made: metadata.etsy_who_made || settings.default_who_made || "i_did",
      when_made:
        metadata.etsy_when_made || settings.default_when_made || "made_to_order",
      taxonomy_id: Number(metadata.etsy_taxonomy_id || settings.default_taxonomy_id || 1),
      is_supply: metadata.etsy_is_supply ?? settings.default_is_supply ?? false,
      type: metadata.etsy_type || settings.default_type || "physical",
      tags,
      shipping_profile_id: settings.default_shipping_profile_id
        ? Number(settings.default_shipping_profile_id)
        : undefined,
      return_policy_id: settings.default_return_policy_id
        ? Number(settings.default_return_policy_id)
        : undefined,
      readiness_state_id: settings.default_readiness_state_id
        ? Number(settings.default_readiness_state_id)
        : undefined,
    }

    return new StepResponse({
      product_id: input.product_id,
      product_title: product.title,
      product_status: product.status,
      listing_input,
      image_urls,
      existing_listing_id,
    })
  }
)

// ── Step 3: create/update listing, upload images, optionally publish ─────

const syncListingStep = createStep(
  "etsy-sync-listing-step",
  async (
    input: {
      config: ResolvedConfig
      prepared: PreparedProduct
    },
    { container }
  ): Promise<StepResponse<SyncResult, { listing_id: string; shop_id: string }>> => {
    const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)
    const client = service.getClient()
    const { access_token, shop_id, settings } = input.config
    const { listing_input, image_urls, existing_listing_id, product_status } =
      input.prepared

    const warnings: string[] = []
    let listing: ListingResponse

    // ── Pre-flight: inspect the live listing before mutating it ────────────
    // On a re-sync the listing already exists on Etsy. Read its current state
    // and image count FIRST so we don't blindly re-run work that would fail or
    // duplicate — the classic symptom is re-uploading the same photos onto a
    // listing that already has the max 20 images (Etsy appends, it never
    // replaces on upload) and getting "Listings are only allowed 20 images".
    const ETSY_MAX_IMAGES = 20
    let existingImages: Array<{ listing_image_id: string; rank: number }> = []
    let imagesUnreadable = false
    let listingMissing = false
    if (existing_listing_id) {
      try {
        const current = await client.getListing(access_token, existing_listing_id)
        if (current?.state) {
          warnings.push(`Listing is currently "${current.state}" on Etsy before this update.`)
        }
      } catch (err: any) {
        // 404 → the listing was deleted on Etsy; fall back to a fresh create.
        listingMissing = true
        warnings.push(`Existing listing not found on Etsy (${err?.message || "gone"}); creating a new one.`)
      }
      if (!listingMissing) {
        try {
          existingImages = await client.getListingImages(access_token, shop_id, existing_listing_id)
        } catch {
          // Can't read images — flag it so we don't risk busting the 20-image cap.
          imagesUnreadable = true
        }
      }
    }
    let existingImageCount = existingImages.length

    const isUpdate = Boolean(existing_listing_id) && !listingMissing
    if (isUpdate) {
      listing = await client.updateListing(
        access_token,
        shop_id,
        existing_listing_id!,
        listing_input
      )
    } else {
      listing = await client.createDraftListing(access_token, shop_id, listing_input)
    }

    // Upload images (Etsy requires >=1 image to publish). Etsy *appends* on
    // upload — it never overwrites — and caps a listing at 20 images, so a naive
    // re-sync duplicates photos and eventually trips "only allowed 20 images".
    // Fix: on an update, remove the listing's current images FIRST, then upload
    // the product's images fresh. Only clear when we actually have replacements
    // to put back, so a product with no images never strips a live listing bare.
    const uploaded_images: UploadedImage[] = []
    const toUpload = image_urls.slice(0, ETSY_MAX_IMAGES)

    if (isUpdate && existingImages.length > 0 && toUpload.length > 0) {
      for (const im of existingImages) {
        try {
          await client.deleteListingImage(
            access_token,
            shop_id,
            listing.listing_id,
            im.listing_image_id
          )
        } catch (err: any) {
          warnings.push(`Could not remove old image ${im.listing_image_id}: ${err.message}`)
        }
      }
      existingImageCount = 0
    } else if (isUpdate && imagesUnreadable && toUpload.length > 0) {
      // We couldn't read the listing's images, so we can't safely clear them.
      // Skip upload rather than risk appending past the 20-image cap.
      warnings.push(
        "Skipped image upload: couldn't read the listing's current images to replace them safely."
      )
    }

    const shouldUpload =
      toUpload.length > 0 && !(isUpdate && imagesUnreadable)
    if (shouldUpload) {
      for (let i = 0; i < toUpload.length; i++) {
        try {
          const { buffer, filename } = await EtsyClient.fetchImageBuffer(toUpload[i])
          const img = await client.uploadListingImage(
            access_token,
            shop_id,
            listing.listing_id,
            buffer,
            filename,
            { rank: i + 1 }
          )
          uploaded_images.push(img)
        } catch (err: any) {
          warnings.push(`Image ${i + 1} upload failed: ${err.message}`)
        }
      }
      if (image_urls.length > ETSY_MAX_IMAGES) {
        warnings.push(`Only the first ${ETSY_MAX_IMAGES} images were uploaded (Etsy limit).`)
      }
    }

    // Publish decision: follow product status
    const shouldPublish =
      settings.follow_product_status !== false && product_status === "published"

    // A listing is publishable if it has images either freshly uploaded now or
    // already living on Etsy from a prior sync.
    const hasImages = uploaded_images.length > 0 || existingImageCount > 0
    const isPhysical = listing_input.type !== "download"
    const canPublish =
      hasImages &&
      (!isPhysical ||
        (listing_input.shipping_profile_id &&
          listing_input.return_policy_id &&
          listing_input.readiness_state_id))

    let published = false
    if (shouldPublish) {
      if (canPublish) {
        try {
          listing = await client.updateListing(access_token, shop_id, listing.listing_id, {
            state: "active",
          })
          published = true
        } catch (err: any) {
          warnings.push(`Publish failed, kept as draft: ${err.message}`)
        }
      } else {
        warnings.push(
          "Published as draft: missing image, shipping profile, return policy, or readiness state. Complete the setup wizard to publish."
        )
      }
    }

    return new StepResponse(
      {
        listing,
        listing_url: listingDisplayUrl(listing),
        uploaded_images,
        published,
        warnings,
      },
      { listing_id: listing.listing_id, shop_id }
    )
  },
  // Compensation: best-effort — cannot undo Etsy create, but mark nothing.
  async () => {}
)

// ── Step 4: persist sync record + link ───────────────────────────────────

const persistSyncResultStep = createStep(
  "etsy-persist-sync-result-step",
  async (
    input: {
      config: ResolvedConfig
      prepared: PreparedProduct
      result: SyncResult
    },
    { container }
  ): Promise<StepResponse<void>> => {
    const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    const { config, prepared, result } = input
    const status: "success" | "draft" = result.published
      ? "success"
      : result.listing.state === "draft"
        ? "draft"
        : "success"

    // Historical record
    await service.createSyncRecord({
      product_id: prepared.product_id,
      account_id: config.account_id,
      listing_id: result.listing.listing_id,
      listing_url: result.listing_url,
      listing_state: result.listing.state,
      action: prepared.existing_listing_id ? "update" : "create",
      status,
      published: result.published,
      error_message: result.warnings.length ? result.warnings.join(" | ") : null,
      warnings: result.warnings,
      metadata: { title: prepared.product_title },
      synced_at: new Date(),
    } as any)

    // Current-state link (upsert)
    try {
      await remoteLink.dismiss([
        {
          [Modules.PRODUCT]: { product_id: prepared.product_id },
          [ETSY_SYNC_MODULE]: { etsy_sync_account_id: config.account_id },
        },
      ])
    } catch {
      // ignore dismiss errors
    }

    await remoteLink.create([
      {
        [Modules.PRODUCT]: { product_id: prepared.product_id },
        [ETSY_SYNC_MODULE]: { etsy_sync_account_id: config.account_id },
        data: {
          etsy_listing_id: result.listing.listing_id,
          etsy_url: result.listing_url,
          sync_status: "synced",
          last_synced_at: new Date(),
          sync_error: result.warnings.length ? result.warnings.join(" | ") : null,
          metadata: {
            published: result.published,
            state: result.listing.state,
            // Medusa status at last sync — the subscriber compares against this
            // so an unrelated product edit doesn't trigger a redundant re-sync.
            product_status: prepared.product_status,
          },
        },
      },
    ])

    return new StepResponse()
  }
)

// ── Workflow ─────────────────────────────────────────────────────────────

export const syncProductToEtsyWorkflow = createWorkflow(
  SYNC_PRODUCT_TO_ETSY,
  (input: WorkflowData<SyncProductToEtsyInput>) => {
    const config = resolveEtsyConfigStep()
    const prepared = prepareProductStep(
      transform({ input, config }, (data) => ({
        product_id: data.input.product_id,
        settings: data.config.settings,
        currency: data.config.currency,
      }))
    )

    const result = syncListingStep(
      transform({ config, prepared }, (data) => ({
        config: data.config,
        prepared: data.prepared,
      }))
    )

    persistSyncResultStep(
      transform({ config, prepared, result }, (data) => ({
        config: data.config,
        prepared: data.prepared,
        result: data.result,
      }))
    )

    return new WorkflowResponse({
      listing_id: result.listing.listing_id,
      listing_url: result.listing_url,
      published: result.published,
      state: result.listing.state,
      warnings: result.warnings,
    })
  }
)
