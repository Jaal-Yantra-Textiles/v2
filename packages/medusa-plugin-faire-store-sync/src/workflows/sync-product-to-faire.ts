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
import { FAIRE_SYNC_MODULE } from "../modules/faire-sync"
import FaireSyncService from "../modules/faire-sync/service"
import {
  CreateProductInput,
  ProductResponse,
} from "../lib/types"

export const SYNC_PRODUCT_TO_FAIRE = "faire-sync-product"

export type SyncProductToFaireInput = {
  product_id: string
}

type ResolvedConfig = {
  account_id: string
  brand_id: string
  access_token: string
  auth_mode: "oauth" | "apiKey"
  currency: string | null
  country: string | null
  settings: any
}

type PreparedProduct = {
  product_id: string
  product_title: string
  product_status: string
  product_input: CreateProductInput
  existing_product_token: string | null
}

type SyncResult = {
  product: ProductResponse
  published: boolean
  warnings: string[]
}

/**
 * Faire doesn't expose a public storefront URL for every product the way Etsy
 * does; fall back to the brand portal link if no url is present.
 */
const productDisplayUrl = (product: ProductResponse): string | null => {
  if (product.url) return product.url
  if (!product.product_token) return null
  return `https://www.faire.com/brand/products/${product.product_token}`
}

/**
 * Faire variant prices are geo-scoped (`geo_constraint`). Derive a sensible
 * default from the brand's currency (and country when known). Eurozone brands
 * map to the EUROPEAN_UNION country_group; otherwise scope to a single country.
 */
const geoForCurrency = (
  currency: string,
  country: string | null
): { country?: string; country_group?: string } => {
  switch (currency) {
    case "EUR":
      return { country_group: "EUROPEAN_UNION" }
    case "GBP":
      return { country: "GB" }
    case "USD":
      return { country: "US" }
    case "CAD":
      return { country: "CA" }
    case "AUD":
      return { country: "AU" }
    default:
      return country ? { country } : { country_group: "EUROPEAN_UNION" }
  }
}

// ── Step 1: resolve account (fresh token) + settings ─────────────────────

const resolveFaireConfigStep = createStep(
  "faire-resolve-config-step",
  async (_, { container }): Promise<StepResponse<ResolvedConfig>> => {
    const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)
    const account = await service.ensureFreshToken()
    const settings = await service.getSettings()
    return new StepResponse({
      account_id: account.id,
      brand_id: account.brand_id,
      access_token: account.access_token,
      auth_mode: (account.auth_mode as "oauth" | "apiKey") ?? "oauth",
      currency: account.currency ?? null,
      country: account.country ?? null,
      settings,
    })
  }
)

// ── Step 2: fetch + map product ──────────────────────────────────────────

const prepareProductStep = createStep(
  "faire-prepare-product-step",
  async (
    input: {
      product_id: string
      settings: any
      brand_id: string
      currency: string | null
      country: string | null
      access_token: string
      auth_mode: "oauth" | "apiKey"
    },
    { container }
  ): Promise<StepResponse<PreparedProduct>> => {
    const query = container.resolve(
      ContainerRegistrationKeys.QUERY
    ) as Omit<RemoteQueryFunction, symbol>
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)

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
        "variants.options.*",
        "variants.options.option.*",
        "variants.inventory_items.*",
        "images.*",
        "variants.sku",
      ],
      filters: { id: input.product_id },
    })

    const product: any = products?.[0]
    if (!product) {
      throw new Error(`Product ${input.product_id} not found`)
    }

    // Resolve existing Faire product (from link)
    let existing_product_token: string | null = null
    const account = await service.getActiveAccount()
    if (account) {
      try {
        const linkRows = await remoteLink.list({
          [Modules.PRODUCT]: { product_id: input.product_id },
          [FAIRE_SYNC_MODULE]: { faire_sync_account_id: account.id },
        })
        const row: any = (linkRows as any[])?.[0]
        existing_product_token = row?.faire_product_token ?? null
      } catch {
        // no link yet
      }
    }

    const settings = input.settings
    const metadata = product.metadata || {}
    const variants: any[] = product.variants || []

    // ── Currency + geo constraint (Faire prices are geo-scoped) ────────────
    // Prefer the brand's own currency; fall back to the price currency Medusa
    // stored, then EUR. Currency picks the price row + drives the geo default.
    const currency = String(
      metadata.faire_currency ||
        input.currency ||
        (variants.flatMap((v) => v.prices || [])[0]?.currency_code ?? "EUR")
    ).toUpperCase()
    const geoConstraint: { country?: string; country_group?: string } =
      metadata.faire_geo_constraint && typeof metadata.faire_geo_constraint === "object"
        ? metadata.faire_geo_constraint
        : geoForCurrency(currency, input.country)

    // Medusa v2 stores money as a whole decimal in the price's currency; Faire
    // wants integer minor units (cents), so round.
    const toMinor = (amount: any): number => Math.round(Number(amount || 0) * 100)

    const markupPercent =
      Number(metadata.faire_wholesale_markup_percent ?? settings.default_wholesale_markup_percent) ||
      0

    // Pick the price row matching the chosen currency (fall back to first).
    const pickPrice = (prices: any[]): any =>
      prices.find((p) => String(p.currency_code || "").toUpperCase() === currency) ??
      prices[0] ??
      null

    const buildVariant = (v: any, idx: number) => {
      const retail = pickPrice(v.prices || [])
      const retailMinor = retail ? toMinor(retail.amount) : 0
      const wholesaleMinor =
        markupPercent > 0
          ? Math.round((retailMinor * (100 - markupPercent)) / 100)
          : retailMinor
      const sku = v.sku || v.id
      const options =
        (v.options || [])
          .map((o: any) => ({
            name: String(o.option?.title || o.title || "Option"),
            value: String(o.value ?? ""),
          }))
          .filter((o: any) => o.value) || []
      return {
        sku,
        name: v.title || sku,
        idempotence_token: `${product.id}:${v.id || sku}`,
        options: options.length ? options : undefined,
        available_quantity: Number(v.inventory_quantity) || 0,
        prices:
          retailMinor > 0
            ? [
                {
                  geo_constraint: geoConstraint,
                  wholesale_price: { amount_minor: wholesaleMinor, currency },
                  retail_price: { amount_minor: retailMinor, currency },
                },
              ]
            : undefined,
      }
    }

    const images = (product.images || [])
      .map((img: any) => ({ url: img.url }))
      .filter((i: any) => i.url)

    // Resolve taxonomy_type.id — REQUIRED by Faire create. Priority:
    //   product.metadata.faire_taxonomy_type_id (tt_… or a category name)
    //   → settings.default_category (id or name) → error.
    const client = service.getClient(input.auth_mode)
    const categoryHint =
      metadata.faire_taxonomy_type_id ||
      metadata.faire_category ||
      settings.default_category ||
      ""
    const taxonomyTypeId = await client.resolveTaxonomyTypeId(
      input.access_token,
      String(categoryHint)
    )
    if (!taxonomyTypeId) {
      throw new Error(
        "Faire requires a product category (taxonomy_type). Set a Faire " +
          "category in sync settings (default_category) or on the product " +
          "(metadata.faire_taxonomy_type_id — a `tt_…` id or a category name)."
      )
    }

    const lifecycle_state: "DRAFT" | "PUBLISHED" =
      settings.follow_product_status !== false && product.status === "published"
        ? "PUBLISHED"
        : "DRAFT"

    const builtVariants = (variants.length ? variants : [null]).map((v, i) =>
      v
        ? buildVariant(v, i)
        : {
            // Single-variant fallback for products with no explicit variants.
            sku: product.id,
            name: product.title || "Default",
            idempotence_token: `${product.id}:default`,
            available_quantity: 0,
          }
    )

    const product_input: CreateProductInput = {
      name: (product.title || "Untitled Product").slice(0, 140),
      idempotence_token: product.id,
      lifecycle_state,
      taxonomy_type: { id: taxonomyTypeId },
      description: product.description || "",
      short_description:
        typeof metadata.faire_short_description === "string"
          ? metadata.faire_short_description
          : undefined,
      images,
      variants: builtVariants,
    }

    return new StepResponse({
      product_id: input.product_id,
      product_title: product.title,
      product_status: product.status,
      product_input,
      existing_product_token,
    })
  }
)

// ── Step 3: create/update product + push inventory ───────────────────────

const syncProductStep = createStep(
  "faire-sync-product-step",
  async (
    input: {
      config: ResolvedConfig
      prepared: PreparedProduct
    },
    { container }
  ): Promise<StepResponse<SyncResult>> => {
    const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)
    const client = service.getClient(input.config.auth_mode)
    const { access_token, settings } = input.config
    const { product_input, existing_product_token, product_status } =
      input.prepared

    const warnings: string[] = []
    let product: ProductResponse

    try {
      if (existing_product_token) {
        product = await client.updateProduct(access_token, existing_product_token, {
          name: product_input.name,
          description: product_input.description,
          short_description: product_input.short_description,
          lifecycle_state: product_input.lifecycle_state,
          taxonomy_type: product_input.taxonomy_type,
          images: product_input.images,
          variants: product_input.variants,
        })
      } else {
        product = await client.createProduct(access_token, product_input)
      }
    } catch (err: any) {
      // Image fetch/upload failures shouldn't abort the whole sync.
      warnings.push(`Product create/update failed: ${err?.message || err}`)
      throw err
    }

    // Push inventory levels for each variant.
    if (product_input.variants?.length) {
      try {
        const levels = product_input.variants.map((v) => ({
          sku: v.sku,
          on_hand_quantity: v.available_quantity ?? 0,
        }))
        await client.updateInventory(access_token, levels)
      } catch (err: any) {
        warnings.push(`Inventory push failed: ${err?.message || err}`)
      }
    }

    // Publish decision: follow product status.
    const shouldPublish =
      settings.follow_product_status !== false && product_status === "published"
    const published = shouldPublish && product.state === "active"

    return new StepResponse({
      product,
      published,
      warnings,
    })
  },
  async () => {}
)

// ── Step 4: persist sync record + link ───────────────────────────────────

const persistSyncResultStep = createStep(
  "faire-persist-sync-result-step",
  async (
    input: {
      config: ResolvedConfig
      prepared: PreparedProduct
      result: SyncResult
    },
    { container }
  ): Promise<StepResponse<void>> => {
    const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    const { config, prepared, result } = input
    const status: "success" | "draft" = result.published
      ? "success"
      : result.product.state === "draft"
        ? "draft"
        : "success"

    await service.createSyncRecord({
      product_id: prepared.product_id,
      account_id: config.account_id,
      product_token: result.product.product_token,
      product_url: productDisplayUrl(result.product),
      product_state: result.product.state,
      action: prepared.existing_product_token ? "update" : "create",
      status,
      published: result.published,
      error_message: result.warnings.length ? result.warnings.join(" | ") : null,
      warnings: result.warnings,
      metadata: { title: prepared.product_title },
      synced_at: new Date(),
    } as any)

    try {
      await remoteLink.dismiss([
        {
          [Modules.PRODUCT]: { product_id: prepared.product_id },
          [FAIRE_SYNC_MODULE]: { faire_sync_account_id: config.account_id },
        },
      ])
    } catch {
      // ignore dismiss errors
    }

    await remoteLink.create([
      {
        [Modules.PRODUCT]: { product_id: prepared.product_id },
        [FAIRE_SYNC_MODULE]: { faire_sync_account_id: config.account_id },
        data: {
          faire_product_token: result.product.product_token,
          faire_url: productDisplayUrl(result.product),
          sync_status: "synced",
          last_synced_at: new Date(),
          sync_error: result.warnings.length ? result.warnings.join(" | ") : null,
          metadata: {
            published: result.published,
            state: result.product.state,
            product_status: prepared.product_status,
          },
        },
      },
    ])

    return new StepResponse()
  }
)

// ── Workflow ─────────────────────────────────────────────────────────────

export const syncProductToFaireWorkflow = createWorkflow(
  SYNC_PRODUCT_TO_FAIRE,
  (input: WorkflowData<SyncProductToFaireInput>) => {
    const config = resolveFaireConfigStep()
    const prepared = prepareProductStep(
      transform({ input, config }, (data) => ({
        product_id: data.input.product_id,
        settings: data.config.settings,
        brand_id: data.config.brand_id,
        currency: data.config.currency,
        country: data.config.country,
        access_token: data.config.access_token,
        auth_mode: data.config.auth_mode,
      }))
    )

    const result = syncProductStep(
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
      product_token: result.product.product_token,
      product_url: productDisplayUrl(result.product),
      published: result.published,
      state: result.product.state,
      warnings: result.warnings,
    })
  }
)
