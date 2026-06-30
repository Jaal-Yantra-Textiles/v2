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

export type SyncProductToEtsyInput = {
  product_id: string
}

type ResolvedConfig = {
  account_id: string
  shop_id: string
  access_token: string
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
      settings,
    })
  }
)

// ── Step 2: fetch + map product ──────────────────────────────────────────

const prepareProductStep = createStep(
  "etsy-prepare-product-step",
  async (
    input: { product_id: string; settings: any },
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

    // Min price across variant prices (Medusa stores amounts in minor units)
    const priceAmounts = variants
      .flatMap((v) => v.prices || [])
      .map((p) => Number(p.amount))
      .filter((a) => a > 0)
    const minPrice = priceAmounts.length ? Math.min(...priceAmounts) / 100 : 0

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

    if (existing_listing_id) {
      listing = await client.updateListing(
        access_token,
        shop_id,
        existing_listing_id,
        listing_input
      )
    } else {
      listing = await client.createDraftListing(access_token, shop_id, listing_input)
    }

    // Upload images (Etsy requires >=1 image to publish)
    const uploaded_images: UploadedImage[] = []
    for (let i = 0; i < image_urls.length; i++) {
      try {
        const { buffer, filename } = await EtsyClient.fetchImageBuffer(image_urls[i])
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

    // Publish decision: follow product status
    const shouldPublish =
      settings.follow_product_status !== false && product_status === "published"

    const isPhysical = listing_input.type !== "download"
    const canPublish =
      uploaded_images.length > 0 &&
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
      listing_url: result.listing.url ?? null,
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
          etsy_url: result.listing.url ?? null,
          sync_status: "synced",
          last_synced_at: new Date(),
          sync_error: result.warnings.length ? result.warnings.join(" | ") : null,
          metadata: { published: result.published, state: result.listing.state },
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
      listing_url: result.listing.url,
      published: result.published,
      state: result.listing.state,
      warnings: result.warnings,
    })
  }
)
