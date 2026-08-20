/**
 * #1380 / #1370 — ONE workflow behind every partner product create.
 *
 * Five paths reach `createProductsWorkflow`. That duplication is not cosmetic:
 * it shipped the FX-fanout gap that became #1370 Open 1, and then hid the 504
 * from measurement because only one of the two live routes was instrumented.
 * This workflow is the single place the post-create work is described, so a
 * fix lands once instead of four times.
 *
 * The branching is the point. Measured on prod (2026-08-20, `80d8e10e0`):
 *
 *   [partners/products]        total=11398ms ... inventoryLevels=7999ms
 *   [partners/stores/products] total=4399ms  ... inventoryLevels=4091ms
 *
 * 70% and 93% of those requests were spent in `ensureInventoryLevelsForVariants`
 * — on payloads that are entirely `manage_inventory: false`, where the helper
 * runs two `query.graph` calls and then returns having written nothing. The
 * `when()` gates below mean that work only happens when there is actually
 * something to seed. `createProductsWorkflow` already returns `manage_inventory`
 * per variant, so the decision needs no extra read.
 */
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { ensureInventoryLevelsForVariants } from "../../api/partners/helpers"
import { requestVariantPriceFanout } from "../fx/fanout-variant-prices"
import {
  isCoreChannelListingPartner,
  recordArtisanProposal,
} from "../../api/partners/products/lib/artisan-proposal"

export type CreatePartnerProductInput = {
  /**
   * Owning partner. Optional because the admin "create on behalf of" route
   * resolves an owner but does not run the partner-facing proposal gate.
   */
  partnerId?: string | null
  storeId: string
  /** Raw product payload. Route validators stay the source of truth for shape. */
  product: Record<string, any>
  /**
   * Legacy `POST /partners/products` refuses a store with no default sales
   * channel (documented 400). The store-scoped route has always just skipped
   * the injection instead. Preserved per-caller rather than unified, because
   * changing either one is a wire-visible change to a live client.
   */
  requireSalesChannel?: boolean
  /**
   * Run the #859 artisan proposal gate (status → `proposed`, ownership link,
   * `partner_product.proposed`). Default true. The admin and discover-copy
   * paths have never applied it and turning it on for them would silently
   * change what those routes publish.
   */
  applyArtisanGate?: boolean
  /**
   * Channels to attach. Defaults to the store's default sales channel, which is
   * what every partner-facing route has always forced. Discover-copy resolves
   * its own channel, so it passes one explicitly rather than being overridden.
   */
  salesChannelIds?: string[]
  /**
   * Seed 0-quantity `inventory_level` rows for managed variants. Default true.
   * Quick-create opts out because it writes a REAL quantity at the store's
   * default location straight after, and seeding first would race it to the
   * same (item, location) pair.
   */
  seedInventoryLevels?: boolean
}

type StoreCtx = {
  id: string
  default_sales_channel_id: string | null
}

/**
 * Resolve the store and the artisan proposal gate in one read. Both create
 * routes needed both facts; neither had them in the same place.
 */
export const resolvePartnerProductContextStep = createStep(
  "resolve-partner-product-context",
  async (
    input: {
      partnerId: string | null
      storeId: string
      requireSalesChannel: boolean
      applyArtisanGate: boolean
    },
    { container }
  ) => {
    const t0 = Date.now()

    const storeService: any = container.resolve(Modules.STORE)
    const [store] = await storeService.listStores({ id: input.storeId })

    if (!store) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Store ${input.storeId} not found`
      )
    }
    if (input.requireSalesChannel && !store.default_sales_channel_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Store ${input.storeId} has no default sales channel configured`
      )
    }

    // Skip the onboarding-profile read entirely when the caller does not run
    // the gate — there is no partner to look up on the admin path.
    const isCoreChannelListing =
      input.applyArtisanGate && input.partnerId
        ? await isCoreChannelListingPartner(container, input.partnerId)
        : false

    const ctx: StoreCtx = {
      id: store.id,
      default_sales_channel_id: store.default_sales_channel_id ?? null,
    }

    return new StepResponse({
      store: ctx,
      isCoreChannelListing,
      ms: Date.now() - t0,
    })
  }
)

/**
 * Ownership link + `partner_product.proposed`. Only artisans on the core
 * channel produce a proposal, so this is gated rather than always-run.
 * Never throws (`link.create` is not idempotent — see the helper).
 */
export const recordArtisanProposalStep = createStep(
  "record-artisan-proposal",
  async (
    input: { partnerId: string; productId: string },
    { container }
  ) => {
    const t0 = Date.now()
    await recordArtisanProposal(container, input.partnerId, input.productId)
    return new StepResponse({ ms: Date.now() - t0 })
  }
)

/**
 * Seed `inventory_level` rows at the partner's stock location(s). Gated on the
 * product actually having a managed-inventory variant — see the file header for
 * what this cost when it was unconditional.
 */
export const ensurePartnerInventoryLevelsStep = createStep(
  "ensure-partner-inventory-levels",
  async (
    input: { store: StoreCtx; variantIds: string[] },
    { container }
  ) => {
    const t0 = Date.now()
    await ensureInventoryLevelsForVariants(
      container,
      input.store,
      input.variantIds
    )
    return new StepResponse({ ms: Date.now() - t0 })
  }
)

/**
 * Emit `fx.fanout_requested` so the worker materialises auto-converted prices
 * in the store's other supported currencies. Async by design — the worker does
 * the work. Gated on there being variants at all.
 */
export const requestPartnerPriceFanoutStep = createStep(
  "request-partner-price-fanout",
  async (
    input: { storeId: string; variantIds?: string[]; priceIds?: string[] },
    { container }
  ) => {
    const t0 = Date.now()
    // Either axis is valid: the create paths know their new variants, the batch
    // path knows the exact prices it touched. `requestVariantPriceFanout`
    // no-ops when both are empty rather than waking the worker for nothing.
    await requestVariantPriceFanout(container, {
      storeId: input.storeId,
      variantIds: input.variantIds,
      priceIds: input.priceIds,
    })
    return new StepResponse({ ms: Date.now() - t0 })
  }
)

export type PostCreateFacts = {
  productId: string | null
  variantIds: string[]
  hasManagedVariants: boolean
}

/**
 * Read the branch decisions off what `createProductsWorkflow` already returned.
 *
 * Exported and pure on purpose: `hasManagedVariants` is what stands between a
 * request and the 4–8s `ensureInventoryLevelsForVariants` phase, so it is the
 * one piece of this workflow that has to be provably right. Getting it wrong in
 * the false direction silently stops seeding inventory levels — which is the
 * bug the helper was written to fix in the first place.
 */
export const derivePostCreateFacts = (created: unknown): PostCreateFacts => {
  const product = (created as any)?.[0]
  const variants = (product?.variants || []) as any[]
  return {
    productId: product?.id ?? null,
    variantIds: variants.map((v: any) => v?.id).filter(Boolean),
    // Strictly `=== true`. A variant whose `manage_inventory` is missing from
    // the payload must NOT be treated as managed.
    hasManagedVariants: variants.some((v: any) => v?.manage_inventory === true),
  }
}

export const createPartnerProductWorkflow = createWorkflow(
  "create-partner-product",
  function (input: CreatePartnerProductInput) {
    const ctx = resolvePartnerProductContextStep(
      transform({ input }, ({ input }) => ({
        partnerId: input.partnerId ?? null,
        storeId: input.storeId,
        requireSalesChannel: input.requireSalesChannel === true,
        // Default ON: the partner-facing routes are the majority and the gate
        // is what keeps an artisan's product out of the storefront.
        applyArtisanGate: input.applyArtisanGate !== false,
      }))
    )

    // Sales-channel injection + the artisan status override, in one place.
    // The proposal override deliberately wins over any client-supplied status.
    const products = transform({ input, ctx }, ({ input, ctx }) => {
      const product: Record<string, any> = {
        ...input.product,
        title: input.product?.title || "",
      }
      if (ctx.isCoreChannelListing) {
        product.status = "proposed"
      }
      // An explicit channel list wins; otherwise force the store default, which
      // is what every partner route has always done (a client-supplied
      // `sales_channels` has never been honoured here and still is not).
      const channelIds = input.salesChannelIds?.length
        ? input.salesChannelIds
        : ctx.store.default_sales_channel_id
          ? [ctx.store.default_sales_channel_id]
          : []
      if (channelIds.length) {
        product.sales_channels = channelIds.map((id: string) => ({ id }))
      }
      return [product]
    })

    const created = createProductsWorkflow.runAsStep({
      input: { products: products as any },
    })

    // `manage_inventory` comes back on the created variants, so the gate below
    // costs nothing — no extra read to decide whether to do the expensive read.
    const facts = transform({ created }, ({ created }) =>
      derivePostCreateFacts(created)
    )

    // Step inputs are built at the top level, never inside a `when().then()`
    // block — the branch body should only invoke the step.
    const proposalInput = transform({ input, facts }, ({ input, facts }) => ({
      partnerId: (input.partnerId || "") as string,
      productId: (facts.productId || "") as string,
    }))
    const inventoryInput = transform({ ctx, facts }, ({ ctx, facts }) => ({
      store: ctx.store,
      variantIds: facts.variantIds,
    }))
    const fanoutInput = transform({ ctx, facts }, ({ ctx, facts }) => ({
      storeId: ctx.store.id,
      variantIds: facts.variantIds,
    }))

    // Only an artisan on the core channel produces a proposal.
    const proposal = when(
      { ctx, facts },
      ({ ctx, facts }) =>
        ctx.isCoreChannelListing === true && Boolean(facts.productId)
    ).then(function () {
      return recordArtisanProposalStep(proposalInput)
    })

    // The gate that matters: no managed variant, no inventory work at all.
    const inventory = when(
      { input, facts },
      ({ input, facts }) =>
        input.seedInventoryLevels !== false && facts.hasManagedVariants === true
    ).then(function () {
      return ensurePartnerInventoryLevelsStep(inventoryInput)
    })

    // Nothing to convert if the product came in without variants.
    const fanout = when(
      { facts },
      ({ facts }) => facts.variantIds.length > 0
    ).then(function () {
      return requestPartnerPriceFanoutStep(fanoutInput)
    })

    // Phase timings survive the move into the workflow. A skipped branch
    // reports `skipped`, NOT `0ms` — `inventoryLevels=0ms` already misled this
    // investigation once by reading as "the N+1 fix ran and was free" when it
    // meant "the helper ran and did nothing".
    const result = transform(
      { input, ctx, created, facts, proposal, inventory, fanout },
      ({ input, ctx, created, facts, proposal, inventory, fanout }) => ({
        product: (created as any)?.[0] ?? null,
        partnerId: input.partnerId,
        storeId: ctx.store.id,
        isCoreChannelListing: ctx.isCoreChannelListing,
        phases: {
          context: ctx.ms,
          proposalRecord: proposal ? (proposal as any).ms : "skipped",
          inventoryLevels: inventory ? (inventory as any).ms : "skipped",
          fanoutEmit: fanout ? (fanout as any).ms : "skipped",
          variants: facts.variantIds.length,
          managed: facts.hasManagedVariants,
        },
      })
    )

    return new WorkflowResponse(result)
  }
)

export default createPartnerProductWorkflow
