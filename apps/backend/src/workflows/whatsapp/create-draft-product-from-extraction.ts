import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
  ProductStatus,
} from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { downloadAndSaveWhatsAppMedia } from "./whatsapp-media-helper"
import { buildPartnerProductUrl } from "./partner-product-url"

/**
 * Build a draft product from WhatsApp message extraction.
 *
 * Called from either the WhatsApp visual flow (via the trigger_workflow
 * operation) or a hardcoded handler. Mirrors the partner quick-create
 * route at `src/api/partners/stores/[id]/products/quick/route.ts` —
 * single variant, default option, store-default currency and sales
 * channel — but always writes `status: DRAFT` so misextracted titles
 * or stray photos never become a live product on the storefront. The
 * partner reviews + publishes from admin.
 *
 * Why a workflow (vs. POST-ing to the route):
 *   - Visual flow's `trigger_workflow` operation invokes Medusa
 *     workflows by name. Wrapping the create logic here makes it
 *     callable from the flow without standing up a service account
 *     or HMAC-signing internal HTTP calls.
 *   - Steps + transform give us per-step audit in the workflow
 *     execution log, same shape as our other production-run + payment
 *     workflows.
 */

export type CreateDraftProductFromExtractionInput = {
  partner_id: string
  partner_name: string
  // WhatsApp media IDs from the inbound message (Meta-presigned URLs are
  // short-lived; the media helper downloads + re-uploads to S3 and
  // returns a stable URL). Pass an empty array for caption-only messages.
  media_ids: string[]
  // Subset of fields the textile extraction agent returns. We're lenient
  // on shape because OpenRouter free-tier models occasionally drop
  // fields; the workflow validates `title` at the build step.
  extracted: {
    title?: string | null
    description?: string | null
    suggested_price?: number | null
    fabric_type?: string | null
    colors?: string[] | null
  }
  // Optional caption to stash on the file metadata for future reference.
  caption?: string | null
}

export type CreateDraftProductFromExtractionResult = {
  product_id: string
  product_title: string
  admin_url: string
  rehosted_image_urls: string[]
  status: "draft"
}

// ──────────────────────────────────────────────────────────────────────
// Step 1 — resolve the partner's store + currency + sales channel.
// Same pattern as the partner quick-create route handler. Throws on
// missing store / sales channel / supported_currencies because there's
// no sensible default for a partner without a configured storefront.
// ──────────────────────────────────────────────────────────────────────

type ResolvedStore = {
  store_id: string
  currency_code: string
  default_sales_channel_id: string
}

const resolvePartnerStoreStep = createStep(
  "wa-product-create-resolve-store",
  async (input: { partner_id: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "partners",
      fields: [
        "id",
        "stores.id",
        "stores.default_sales_channel_id",
        "stores.supported_currencies.currency_code",
        "stores.supported_currencies.is_default",
      ],
      filters: { id: input.partner_id },
    } as any)
    const partner = (data as any[])?.[0]
    if (!partner) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Partner ${input.partner_id} not found`
      )
    }
    const store = partner.stores?.[0]
    if (!store) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Partner ${input.partner_id} has no store configured`
      )
    }
    const supported = (store.supported_currencies || []) as Array<{
      currency_code: string
      is_default: boolean
    }>
    const currency_code =
      supported.find((c) => c.is_default)?.currency_code ??
      supported[0]?.currency_code
    if (!currency_code) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Store ${store.id} has no supported currencies`
      )
    }
    if (!store.default_sales_channel_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Store ${store.id} has no default sales channel`
      )
    }
    return new StepResponse({
      store_id: store.id as string,
      currency_code,
      default_sales_channel_id: store.default_sales_channel_id as string,
    } as ResolvedStore)
  }
)

// ──────────────────────────────────────────────────────────────────────
// Step 2 — rehost every WhatsApp media into a stable S3 URL via the
// existing helper. Skipped entries (download failed) drop out of the
// list rather than fail the workflow — a partner sending one valid
// photo + one corrupted one should still get a product.
// ──────────────────────────────────────────────────────────────────────

const rehostMediaStep = createStep(
  "wa-product-create-rehost-media",
  async (
    input: {
      media_ids: string[]
      partner_id: string
      partner_name: string
      caption?: string | null
    },
    { container }
  ) => {
    if (!input.media_ids?.length) {
      return new StepResponse({ image_urls: [] as string[] })
    }
    const results: string[] = []
    for (const mediaId of input.media_ids) {
      const r = await downloadAndSaveWhatsAppMedia(container, {
        mediaId,
        partnerId: input.partner_id,
        partnerName: input.partner_name,
        caption: input.caption ?? undefined,
      })
      if (r?.fileUrl) results.push(r.fileUrl)
    }
    return new StepResponse({ image_urls: results })
  }
)

// ──────────────────────────────────────────────────────────────────────
// Step 3 — build the `createProductsWorkflow` input from the extracted
// fields + the rehosted URLs + the resolved store defaults.
//
// Mirrors the partner quick-create route's payload shape. Single variant,
// "Default option", prices in the store's default currency, sales
// channel pre-bound. Status forced to DRAFT regardless of any caller
// override — a misextracted title must never become a live product.
// ──────────────────────────────────────────────────────────────────────

const buildProductInputStep = createStep(
  "wa-product-create-build-input",
  async (
    input: {
      extracted: CreateDraftProductFromExtractionInput["extracted"]
      image_urls: string[]
      store: ResolvedStore
    }
  ) => {
    const title = input.extracted.title?.trim()
    if (!title) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "extracted.title is required to create a product"
      )
    }
    const price =
      typeof input.extracted.suggested_price === "number" &&
      input.extracted.suggested_price >= 0
        ? input.extracted.suggested_price
        : 0
    const description = input.extracted.description?.trim() || undefined

    const productInput = {
      title,
      description,
      status: ProductStatus.DRAFT,
      thumbnail: input.image_urls[0] || undefined,
      images: input.image_urls.length
        ? input.image_urls.map((url) => ({ url }))
        : undefined,
      sales_channels: [{ id: input.store.default_sales_channel_id }],
      options: [
        { title: "Default option", values: ["Default option value"] },
      ],
      variants: [
        {
          title,
          options: { "Default option": "Default option value" },
          manage_inventory: false,
          prices: [
            { amount: price, currency_code: input.store.currency_code },
          ],
        },
      ],
      // Stash the source so admin can filter / audit WhatsApp-created
      // products later. Keeps the audit trail visible at the product
      // row level, not just in the flow execution log.
      metadata: {
        created_via: "whatsapp",
        wa_fabric_type: input.extracted.fabric_type || null,
        wa_colors: input.extracted.colors || null,
      },
    }
    return new StepResponse({ productInput })
  }
)

// ──────────────────────────────────────────────────────────────────────
// Step 4 — invoke the core createProductsWorkflow with the built input.
// We don't use the workflow composer's `when()` because we always create
// exactly one product per call.
// ──────────────────────────────────────────────────────────────────────

const createDraftProductStep = createStep(
  "wa-product-create-invoke-create",
  async (input: { productInput: any }, { container }) => {
    const { result } = await createProductsWorkflow(container).run({
      input: { products: [input.productInput] },
    })
    const product = (result as any)[0]
    if (!product?.id) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "createProductsWorkflow returned no product"
      )
    }
    return new StepResponse({ product_id: product.id, product_title: product.title })
  }
)

// ──────────────────────────────────────────────────────────────────────
// Workflow assembly.
// ──────────────────────────────────────────────────────────────────────

export const createDraftProductFromExtractionWorkflow = createWorkflow(
  {
    name: "create-draft-product-from-extraction",
    // `store: true` keeps the run + per-step log in the workflow
    // executions table — same as send-to-partner / accept-production-
    // run, so the admin UI can show "WhatsApp → product" history.
    store: true,
  },
  (input: CreateDraftProductFromExtractionInput) => {
    const store = resolvePartnerStoreStep({ partner_id: input.partner_id })

    const media = rehostMediaStep(
      transform({ input }, ({ input }) => ({
        media_ids: input.media_ids || [],
        partner_id: input.partner_id,
        partner_name: input.partner_name,
        caption: input.caption ?? null,
      }))
    )

    const built = buildProductInputStep(
      transform(
        { input, store, media },
        ({ input, store, media }) => ({
          extracted: input.extracted,
          image_urls: media.image_urls,
          store,
        })
      )
    )

    const created = createDraftProductStep(
      transform({ built }, ({ built }) => ({ productInput: built.productInput }))
    )

    return new WorkflowResponse(
      transform(
        { created, media },
        ({ created, media }): CreateDraftProductFromExtractionResult => ({
          product_id: created.product_id,
          product_title: created.product_title,
          // The confirmation message is sent to the PARTNER, who can only open
          // the partner portal — never the admin app. Build an absolute partner
          // portal product link (#707). Field name kept as `admin_url` so the
          // already-seeded message template binding stays intact.
          admin_url: buildPartnerProductUrl(created.product_id),
          rehosted_image_urls: media.image_urls,
          status: "draft",
        })
      )
    )
  }
)
