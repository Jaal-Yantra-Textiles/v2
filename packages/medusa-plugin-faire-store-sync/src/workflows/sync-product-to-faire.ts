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
  currency: string | null
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
      currency: account.currency ?? null,
      settings,
    })
  }
)

// ── Step 2: fetch + map product ──────────────────────────────────────────

const prepareProductStep = createStep(
  "faire-prepare-product-step",
  async (
    input: { product_id: string; settings: any; brand_id: string },
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

    // Medusa v2 stores money as a whole decimal in the price's currency (NOT
    // minor units). Faire wants integer cents, so round to cents.
    const toCents = (amount: any): number => Math.round(Number(amount || 0) * 100)

    const markupPercent =
      Number(metadata.faire_wholesale_markup_percent ?? settings.default_wholesale_markup_percent) ||
      0

    const buildVariant = (v: any) => {
      const prices: any[] = v.prices || []
      const retail = prices[0] ?? prices.find(Boolean)
      const retailCents = retail ? toCents(retail.amount) : 0
      const wholesaleCents =
        markupPercent > 0
          ? Math.round((retailCents * (100 - markupPercent)) / 100)
          : retailCents
      return {
        sku: v.sku || v.id,
        name: v.title || undefined,
        retail_price_cents: retailCents || undefined,
        wholesale_price_cents: wholesaleCents || undefined,
        inventory_count: Number(v.inventory_quantity) || 0,
      }
    }

    // Aggregate retail/wholesale from min-variant for the product-level price.
    const allPrices = variants.flatMap((v) => v.prices || [])
    const minRetail =
      allPrices
        .map((p) => toCents(p.amount))
        .filter((a) => a > 0)
        .sort((a, b) => a - b)[0] ?? 0
    const minWholesale =
      markupPercent > 0
        ? Math.round((minRetail * (100 - markupPercent)) / 100)
        : minRetail

    const tags = (product.tags || [])
      .map((t: any) => t.value)
      .filter(Boolean)

    const images = (product.images || [])
      .map((img: any) => ({ url: img.url }))
      .filter((i: any) => i.url)

    const product_input: CreateProductInput = {
      brand_id: input.brand_id,
      name: (product.title || "Untitled Product").slice(0, 140),
      description: product.description || "",
      wholesale_price_cents: minWholesale || undefined,
      retail_price_cents: minRetail || undefined,
      images,
      variants: variants.length ? variants.map(buildVariant) : undefined,
      tags,
      short_description:
        typeof metadata.faire_short_description === "string"
          ? metadata.faire_short_description
          : undefined,
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
    const client = service.getClient()
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
          images: product_input.images,
          variants: product_input.variants,
          tags: product_input.tags,
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
          current_count: v.inventory_count ?? 0,
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
