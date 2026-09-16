import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createProductFromDesignWorkflow } from "../workflows/designs/create-product-from-design"
import { buildDesignSpec } from "../workflows/designs/lib/design-product-spec"
import { upsertProductSpecWorkflow } from "../workflows/products/upsert-product-spec"
import { DESIGN_MODULE } from "../modules/designs"

/**
 * LOCAL seed for the design → product → storefront size choice (#1970).
 *
 * Sibling of `seed-ikat-spec-local.ts`, and deliberately a different shape.
 * That one hand-writes a spec onto a hand-written product, proving the
 * STOREFRONT renders option groups. This one writes neither: it creates a
 * DESIGN with several sizes and then runs the real mint, so what it proves is
 * that the mint attaches the spec — the half that did not exist.
 *
 * 🔴 It must call `createProductFromDesignWorkflow` and not build the product
 * itself. A seed that assembled the spec by hand would pass with the wiring
 * removed, which is the whole thing under test.
 *
 * Idempotent, but NOT by re-minting.
 *
 * ⚠️ A plain re-run does NOT re-test the wiring — it reads back a spec an
 * earlier mint wrote. To prove the mint still attaches one, delete the design
 * (or rename DESIGN_NAME) so the fresh path runs. That is the path the
 * mutation check uses. `FORCE_REMINT=1` exercises the append branch instead.
 *
 * Usage:
 *   npx medusa exec src/scripts/seed-design-spec-local.ts
 *
 *   # exercise the APPEND branch (mint onto a design that already has a
 *   # product) — the path that used to crash, see #1970
 *   FORCE_REMINT=1 npx medusa exec src/scripts/seed-design-spec-local.ts
 */
/**
 * Overridable so a FRESH design can be seeded without editing this file.
 *
 * The header's "delete the design to re-test the wiring" is easy to skip, and a
 * fixture that has been poked at accumulates variants — three, on the database
 * where this seed was first run for real — which changes what the storefront
 * shows (a variant picker appears and add-to-cart waits on it). A new name is
 * the cheapest clean room.
 *
 *   E2E_DESIGN_NAME="E2E — Shawl $(date +%s)" npx medusa exec src/scripts/seed-design-spec-local.ts
 */
const DESIGN_NAME =
  process.env.E2E_DESIGN_NAME || "E2E — Kashida Shawl, made to size"
const SIZES = ["S", "M", "L", "XL"]

export default async function seedDesignSpecLocal({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const designService: any = container.resolve(DESIGN_MODULE)

  const { data: existing } = await query.graph({
    entity: "design",
    fields: ["id", "name", "size_sets.*", "products.*"],
    filters: { name: DESIGN_NAME },
  })

  let designId = existing?.[0]?.id

  if (!designId) {
    const [design] = await designService.createDesigns([
      {
        name: DESIGN_NAME,
        description:
          "Handwoven Kashida shawl, worked to the size you choose. Seeded for e2e.",
        design_type: "Original",
        status: "Approved",
        priority: "Medium",
        estimated_cost: 8500,
        cost_currency: "inr",
      },
    ])
    designId = design.id

    // The sizes are the point: several, so the mint renders them as a CHOICE
    // rather than stating one as a fact.
    await designService.createDesignSizeSets(
      SIZES.map((size_label) => ({ size_label, design_id: designId }))
    )
    logger.info(
      `[seed] created design ${designId} with ${SIZES.length} size sets`
    )
  } else {
    logger.info(`[seed] design ${designId} already exists`)
  }

  /**
   * Already minted? Reuse it — a re-run is refreshing a fixture, not testing
   * the mint. `FORCE_REMINT=1` opts into the append branch instead, which is
   * how the crash described in the header was reproduced and then verified
   * fixed.
   */
  const alreadyMinted = process.env.FORCE_REMINT ? null : existing?.[0]?.products?.[0]?.id
  if (alreadyMinted) {
    /**
     * A fixture minted into the wrong channel stays broken forever: the
     * product exists, is published, reads back fine in admin — and 404s on the
     * storefront, because the key cannot see that channel. That is exactly the
     * state the old `sales_channels[0]` left this database in, and a re-run
     * that only re-read the spec could never clear it.
     */
    await ensureProductInChannel(
      container,
      query,
      logger,
      alreadyMinted,
      await resolveStorefrontChannel(query, logger)
    )
    /**
     * Re-apply the spec the CURRENT rule produces.
     *
     * A fixture minted before a rule changed keeps the old spec forever, and
     * reading it back reports success on it — which is how a product whose size
     * group was stored but flagged `accepting_custom_orders: false` sat there
     * looking correct while the storefront rendered nothing and the cart
     * refused the line. `upsertProductSpecWorkflow` is idempotent, so this is a
     * refresh, not a re-mint: it does NOT prove the mint attaches a spec (only
     * a fresh design does that), it keeps the fixture honest.
     */
    const refreshed = buildDesignSpec(existing?.[0] as any)
    if (refreshed) {
      await upsertProductSpecWorkflow(container).run({
        input: { product_id: alreadyMinted, data: refreshed },
      })
      logger.info(`[seed] spec refreshed on product ${alreadyMinted}`)
    }
    await reportSpec(query, logger, alreadyMinted)
    return
  }

  /**
   * 🔴 The channel is passed EXPLICITLY, and that is not laziness.
   *
   * `resolveMintSalesChannel` (#2059) refuses when it cannot name a channel —
   * it will not fall back to `listStores({})[0]`, which is the bug that issue
   * fixed. A local database has no house store, so the mint correctly refuses
   * with `no_house_store` unless told which channel to use.
   *
   * 🔴 It used to be `sales_channels[0]`, on the stated assumption of "a
   * single-channel dev database". That assumption is FALSE on a long-lived
   * local database — mine carries five — and row 0 was `Default Sales Channel`
   * while the storefront's publishable key serves a different one. So the seed
   * minted a product the storefront could never see: the page 404'd, the store
   * API returned it in no channel the key can read, and the e2e spec could not
   * run at all. The index engine was blamed for a whole session.
   *
   * The channel is now the one the STOREFRONT'S KEY actually serves, because
   * that is the only channel a storefront spec can observe. Same `[0]` family
   * as #1983 / #2051.
   */
  const salesChannelId = await resolveStorefrontChannel(query, logger)

  // The real door. Everything interesting happens inside it.
  const { result } = await createProductFromDesignWorkflow(container).run({
    input: {
      design_id: designId,
      estimated_cost: 8500,
      currency_code: "inr",
      made_to_order: true,
      sales_channel_id: salesChannelId,
    } as any,
  })

  logger.info(
    `[seed] minted product ${result.product_id} (variant ${result.variant_id})`
  )

  await reportSpec(query, logger, result.product_id)
}

/**
 * Read the spec BACK rather than trusting the mint's own word for it.
 *
 * The spec write is deliberately non-fatal inside the workflow — a product that
 * minted is a product — so a failure there would otherwise leave this seed
 * reporting success on a storefront with no size choices.
 */
async function reportSpec(query: any, logger: any, productId: string) {
  const { data: specs } = await query.graph({
    entity: "product_spec",
    fields: ["id", "size_label", "options.*", "options.values.*"],
    filters: { product_id: productId },
  })

  const spec = specs?.[0]
  if (!spec) {
    throw new Error(
      `[seed] product ${productId} has NO spec — the mint did not attach one, ` +
        `so the storefront will offer no size choice.`
    )
  }

  const sizeGroup = (spec.options ?? []).find((o: any) => o.key === "size")
  logger.info(
    `[seed] spec ${spec.id}: size group has ` +
      `${sizeGroup?.values?.length ?? 0} value(s) — ` +
      `${(sizeGroup?.values ?? []).map((v: any) => v.label).join(", ")}`
  )

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
    filters: { id: productId },
  })
  logger.info(`[seed] product handle: ${products?.[0]?.handle}`)
}

/**
 * The sales channel THIS storefront can actually read.
 *
 * A storefront reaches `/store/*` with a publishable key, and that key is what
 * scopes every product query to a set of channels. So the only channel a
 * storefront spec can observe is one the key serves — any other channel mints a
 * product that exists, is published, and 404s on the page.
 *
 * Order, and a refusal at the end rather than row 0:
 *   1. `E2E_SALES_CHANNEL_ID` — the caller being explicit, which always wins.
 *   2. The channels of the publishable key in `E2E_PUBLISHABLE_KEY` (the
 *      storefront's own `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`). Exactly one → it.
 *   3. The only publishable key on the database, if there is exactly one, and
 *      the only channel it serves.
 *   4. The only sales channel on the database, if there is exactly one.
 * Anything else REFUSES and prints the candidates, because a seed that guesses
 * here produces a product nobody can see and a spec nobody can run.
 */
async function resolveStorefrontChannel(
  query: any,
  logger: any
): Promise<string> {
  const explicit = process.env.E2E_SALES_CHANNEL_ID
  if (explicit) {
    logger.info(`[seed] sales channel ${explicit} (E2E_SALES_CHANNEL_ID)`)
    return explicit
  }

  const keyFilters: Record<string, any> = { type: "publishable" }
  if (process.env.E2E_PUBLISHABLE_KEY) {
    keyFilters.token = process.env.E2E_PUBLISHABLE_KEY
  }

  const { data: keys = [] } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "token", "sales_channels.id", "sales_channels.name"],
    filters: keyFilters,
  })

  const usableKeys = (keys ?? []).filter(
    (k: any) => (k?.sales_channels ?? []).length > 0
  )

  if (usableKeys.length === 1) {
    const channels = usableKeys[0].sales_channels ?? []
    if (channels.length === 1) {
      logger.info(
        `[seed] sales channel ${channels[0].id} (${channels[0].name}) — ` +
          `the one served by publishable key ${usableKeys[0].title ?? usableKeys[0].id}`
      )
      return channels[0].id
    }
    throw new Error(
      `[seed] publishable key ${usableKeys[0].title ?? usableKeys[0].id} serves ` +
        `${channels.length} channels ` +
        `(${channels.map((c: any) => `${c.name} [${c.id}]`).join(", ")}). ` +
        `Set E2E_SALES_CHANNEL_ID to the one the storefront should sell from.`
    )
  }

  if (usableKeys.length > 1) {
    throw new Error(
      `[seed] ${usableKeys.length} publishable keys on this database. Set ` +
        `E2E_PUBLISHABLE_KEY to the storefront's own key (its ` +
        `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY), or E2E_SALES_CHANNEL_ID to the ` +
        `channel directly. Candidates: ` +
        usableKeys
          .map(
            (k: any) =>
              `${k.title ?? k.id} → ${(k.sales_channels ?? [])
                .map((c: any) => c.name)
                .join("/")}`
          )
          .join("; ")
    )
  }

  // No key tells us anything — fall back to the database having exactly one
  // channel, which is the case the old `[0]` was silently assuming.
  const { data: salesChannels = [] } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  })

  if (!salesChannels?.length) {
    throw new Error(
      "[seed] no sales channel on this database — run the base Medusa seed first"
    )
  }
  if (salesChannels.length === 1) {
    logger.info(
      `[seed] sales channel ${salesChannels[0].id} (${salesChannels[0].name}) — ` +
        `the only one on this database`
    )
    return salesChannels[0].id
  }

  throw new Error(
    `[seed] ${salesChannels.length} sales channels and no publishable key to ` +
      `choose between them. Row 0 is not an answer — it mints a product the ` +
      `storefront cannot see. Set E2E_SALES_CHANNEL_ID (or E2E_PUBLISHABLE_KEY). ` +
      `Candidates: ` +
      salesChannels.map((c: any) => `${c.name} [${c.id}]`).join(", ")
  )
}

/**
 * Put an already-minted fixture into the channel the storefront reads.
 *
 * ADDITIVE, and that matters: `updateProductsWorkflow` REPLACES a product's
 * sales-channel set, so sending only the storefront channel would silently
 * remove every other one. The existing channels are read back and re-sent with
 * it — the same rule a service-zone or price-set update lives by here.
 */
async function ensureProductInChannel(
  container: any,
  query: any,
  logger: any,
  productId: string,
  salesChannelId: string
) {
  const { data: products = [] } = await query.graph({
    entity: "product",
    fields: ["id", "sales_channels.id", "sales_channels.name"],
    filters: { id: productId },
  })

  const current = (products?.[0]?.sales_channels ?? []) as Array<{
    id: string
    name?: string
  }>
  if (current.some((c) => c.id === salesChannelId)) {
    logger.info(
      `[seed] product ${productId} is already in sales channel ${salesChannelId}`
    )
    return
  }

  const { updateProductsWorkflow } = await import("@medusajs/medusa/core-flows")
  await updateProductsWorkflow(container).run({
    input: {
      selector: { id: productId },
      update: {
        sales_channels: [
          ...current.map((c) => ({ id: c.id })),
          { id: salesChannelId },
        ],
      },
    } as any,
  })

  // Read it BACK — the write reporting success is not the write landing.
  const { data: after = [] } = await query.graph({
    entity: "product",
    fields: ["id", "sales_channels.id"],
    filters: { id: productId },
  })
  const now = (after?.[0]?.sales_channels ?? []).map((c: any) => c.id)
  if (!now.includes(salesChannelId)) {
    throw new Error(
      `[seed] product ${productId} is STILL not in sales channel ` +
        `${salesChannelId} after the update — it is in ${now.join(", ") || "none"}.`
    )
  }
  logger.info(
    `[seed] product ${productId} added to sales channel ${salesChannelId} ` +
      `(now in ${now.length}: ${now.join(", ")})`
  )
}
