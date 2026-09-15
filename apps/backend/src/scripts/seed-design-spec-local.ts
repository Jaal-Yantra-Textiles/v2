import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createProductFromDesignWorkflow } from "../workflows/designs/create-product-from-design"
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
const DESIGN_NAME = "E2E — Kashida Shawl, made to size"
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
   * Taking `[0]` HERE is a seed convenience on a single-channel dev database,
   * never a rule: the first branch of the resolver is "the caller's explicit
   * sales_channel_id", and this is that caller being explicit.
   */
  const { data: salesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  })
  const salesChannelId = salesChannels?.[0]?.id
  if (!salesChannelId) {
    throw new Error(
      "[seed] no sales channel on this database — run the base Medusa seed first"
    )
  }

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
