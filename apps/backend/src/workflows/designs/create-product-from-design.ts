import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createProductsWorkflow,
  createProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows";
import { DESIGN_MODULE } from "../../modules/designs";
import type { Link } from "@medusajs/modules-sdk";
import { resolveLineItemDesignId } from "../../lib/resolve-line-item-production"
import designCustomerLink from "../../links/design-customer-link"

/**
 * Create Product from Design Workflow
 *
 * Creates a purchasable product/variant from a customer's design.
 *
 * Strategy:
 * 1. If design has a linked product → create variant on that product
 * 2. If no linked product → create new product + variant
 *
 * The variant is linked to the design via design-variant-link,
 * enabling production run creation when the order is placed.
 */

/**
 * The images a minted product should carry, in priority order:
 *   1. every image in the design's linked media folder (the gallery the
 *      retired `promote-design-to-product` built), thumbnail = the first;
 *   2. failing that, the design's own `thumbnail_url`, as before;
 *   3. failing that, nothing — `undefined` thumbnail and an empty list, which
 *      is exactly what this workflow already produced for a design with no
 *      thumbnail. A product with no image is allowed; a BROKEN one is not.
 *
 * A media file counts as an image on either signal the folder records —
 * `file_type === "image"` or an `image/*` mime — because the two are populated
 * by different upload paths and neither is reliably present on its own.
 */
export function resolveDesignGallery(design: {
  thumbnail_url?: string | null;
  folders?: Array<{ media_files?: Array<Record<string, any>> | null }> | null;
}): { thumbnail: string | undefined; images: Array<{ url: string }> } {
  const files = design.folders?.[0]?.media_files ?? [];
  const folderImages = files
    .filter(
      (f: any) => f?.file_type === "image" || f?.mime_type?.startsWith("image/")
    )
    .map((f: any) => f.file_path)
    .filter((p: any): p is string => typeof p === "string" && p.length > 0);

  if (folderImages.length) {
    return {
      thumbnail: folderImages[0],
      images: folderImages.map((url) => ({ url })),
    };
  }

  const thumb = design.thumbnail_url;
  if (typeof thumb === "string" && thumb.length) {
    return { thumbnail: thumb, images: [{ url: thumb }] };
  }

  return { thumbnail: undefined, images: [] };
}

type CreateProductFromDesignInput = {
  design_id: string;
  estimated_cost: number;
  /**
   * Stamped onto the design↔variant link as provenance. Optional: the quote
   * path mints a variant for work that has no buyer yet, which is the whole
   * point of quoting it.
   */
  customer_id?: string;
  currency_code?: string;
  /**
   * Make this a MADE-TO-ORDER variant: something that will be produced after
   * it is bought, rather than something sitting on a shelf.
   *
   * Two things change, and both are required for the variant to be quotable:
   *
   * - `status: "published"` instead of `"draft"`. A draft product's variant is
   *   not purchasable, so an accepted quote would build a cart that cannot be
   *   completed — and acceptance is the step where that would first be
   *   noticed, by the buyer.
   * - `manage_inventory: false`. The whole premise is that the production run
   *   is in the FUTURE, so stock is zero and always will be until the run
   *   happens. A managed variant at zero stock refuses the order.
   *
   * Off by default: the approve route creates a catalogue product that is
   * reviewed before it goes live, and that behaviour is unchanged.
   */
  made_to_order?: boolean;
  /**
   * The price to list, in major units and already in `currency_code`.
   *
   * Overrides `estimated_cost` when given. Both are now written verbatim —
   * see `resolveListedPrice` for what changed and why.
   */
  unit_price?: number | null;
  /**
   * The sales channel the new product belongs in — the catalogue of whoever is
   * quoting or selling it.
   *
   * 🔴 Until this existed the branch below read `listStores({})[0]` and used
   * THAT store's default channel. On a platform with 15 stores that is
   * whichever row Postgres returned first, which in practice was always the
   * core "Default Sales Channel" — so every made-to-order design product ever
   * minted landed in a catalogue belonging to nobody who was quoting it. All
   * 12 on production did. `assertVariantsInStore` then refused the mint, and
   * the readiness preflight refused before that, which is how a whole feature
   * could be shipped, tested and never once produce a quotable design.
   *
   * Omitted, the store default is still the fallback: the approve path creates
   * a catalogue product for the core store and that behaviour is unchanged.
   */
  sales_channel_id?: string | null;
};

type CreateProductFromDesignOutput = {
  product_id: string;
  variant_id: string;
  price: number;
  is_new_product: boolean;
};

/**
 * PURE: the option value an appended variant claims on the product it joins.
 *
 * 🔴 #1874. Every appended variant used to claim the literal `"Custom"` on every
 * option. A design-created product carries one option, `Type`, whose only value
 * is `Custom` — so the second design appended to a product produced an option
 * tuple IDENTICAL to the first. Titles differed, SKUs differed by a millisecond,
 * and the tuple Medusa actually resolves a variant by did not.
 *
 * The design's own name is the natural value: it is already what the variant
 * title carries, and it is what a human picking from a dropdown would expect to
 * see. Two designs sharing a name fall back to a short id suffix rather than
 * colliding — rare, and better than silently producing a duplicate.
 *
 * Exported for tests.
 */
export const designOptionValue = (
  design: { id: string; name?: string | null },
  existingValues: readonly string[] = []
): string => {
  const base = String(design.name ?? "").trim() || `Design ${design.id}`
  if (!existingValues.includes(base)) return base
  return `${base} (${String(design.id).slice(-6)})`
}

/**
 * PURE: how a design-created product is NAMED. Exported for tests.
 *
 * 🔴 This branch hardcoded `title: "Custom Design - <name>"`, an option `Type`
 * whose only value was the literal `"Custom"`, and a variant titled
 * `"Custom Design"`. Three problems:
 *
 *  - The `Custom Design - ` prefix said nothing the `is_custom_design` metadata
 *    does not, and it is what shows in the catalogue, the order line and the
 *    partner portal.
 *  - `design_type` (Original / Derivative / Custom / Collaboration) was already
 *    on the design and went unused, while the option was called "Type".
 *  - The literal `"Custom"` is the exact value #1874 removed from the APPENDED
 *    branch, because two designs on one product then resolved to an identical
 *    option tuple. This branch kept writing it, so a product created here and
 *    appended to later carried `["Custom", "<other design>"]` — the first
 *    variant named after nothing in particular.
 *
 * The design's own name is the value in both branches now, via the same helper.
 */
export const designProductNaming = (design: {
  id: string
  name?: string | null
  design_type?: string | null
}): {
  title: string
  optionTitle: string
  optionValue: string
  variantTitle: string
} => {
  const optionValue = designOptionValue(design)
  return {
    title: optionValue,
    // The design's own classification, when it has one. "Type" is the fallback
    // rather than the default, so an unclassified design still gets a sane
    // option rather than an empty title.
    optionTitle: String(design.design_type ?? "").trim() || "Type",
    optionValue,
    variantTitle: optionValue,
  }
}

/**
 * PURE: the amount written to `variant.prices[].amount`. Exported for tests.
 *
 * Medusa 2.x prices are DECIMAL major units — the seed lists a €10 shirt as
 * `amount: 10` through this same `createProductsWorkflow`, `accept-quote`
 * writes `amount: freight` raw, and the minted price list writes
 * `quoted_unit_amount` raw. This workflow was the only place that multiplied,
 * doing `Math.round(estimated_cost * 100)`: a cent conversion inherited from
 * Medusa v1, where amounts really were minor units.
 *
 * So a design approved at ₹850 was listed at 85,000. Nothing downstream divided
 * it back — and the workflow's own output reported `price: estimated_cost`, the
 * UNMULTIPLIED figure, so it told its caller one price and listed another. That
 * contradiction is the tell that the ×100 was a leftover and not a convention.
 *
 * `unit_price` was added by the quote path precisely to sidestep the multiply;
 * with the multiply gone the two inputs mean the same thing, and `unit_price`
 * simply wins when both are supplied.
 */
export function resolveListedPrice(input: {
  estimated_cost: number;
  unit_price?: number | null;
}): number {
  const raw = input.unit_price != null ? input.unit_price : input.estimated_cost;
  const n = Number(raw);
  // A NaN here would reach the price row and fail the write with nothing said
  // about which design caused it.
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Single step that handles all the product/variant creation logic
 * This consolidates the logic to avoid workflow typing issues with multi-step data passing
 */
const createProductAndVariantStep = createStep(
  "create-product-and-variant-step",
  async (input: CreateProductFromDesignInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link;
    const currencyCode = input.currency_code || "usd";
    const madeToOrder = !!input.made_to_order;

    const priceAmount = resolveListedPrice(input);

    // A made-to-order variant is produced after it is sold, so there is no
    // stock to manage and never will be before the run.
    const manageInventory = !madeToOrder;

    // Get design with its linked products
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: input.design_id },
      fields: [
        "id",
        "name",
        "description",
        "thumbnail_url",
        "design_type",
        // #1920 — the design's linked media folder. Ported from
        // `promote-design-to-product`, the door this workflow absorbs: it
        // sourced the product's WHOLE gallery from the folder, where this one
        // only ever had `thumbnail_url` — a single image. Consolidating the
        // mint points must not quietly cost the catalogue its other photos.
        "folders.*",
        "folders.media_files.*",
        "products.*",
        "products.options.*",
        "products.options.values.*",
        "products.variants.*",
      ],
    });

    if (!designs || designs.length === 0) {
      throw new Error(`Design not found: ${input.design_id}`);
    }

    const design = designs[0];

    /**
     * #1920 — product imagery, folder first.
     *
     * The retired `promote-design-to-product` REFUSED to mint at all when the
     * design had no linked folder, or the folder held no images. That refusal
     * cannot come along: this door mints for approvals, run output and quotes,
     * where a design with no folder is ordinary and blocking it would break
     * paths that work today. So the folder is a source, not a gate — and
     * `thumbnail_url` remains the fallback it always was.
     */
    const gallery = resolveDesignGallery(design);

    /**
     * #1920 item 4 — the buyer, resolved HERE rather than at the caller.
     *
     * `customer_id` is stamped on the design↔variant link's data, and only the
     * approve route ever passed it: a product minted from run output or from a
     * quote recorded no buyer at all. Resolving it inside the workflow means
     * every door gets it, and there is no fourth place to forget.
     *
     * An explicit input still wins — the approve route already has the answer
     * in hand. `?? undefined` and not `|| ""`: the approve route's `|| ""` put
     * an EMPTY STRING on the link for a design with no customer, which reads
     * as "a customer, whose id is blank" to anything that only checks for
     * presence.
     */
    const customerId =
      input.customer_id ||
      (
        await query.graph({
          entity: designCustomerLink.entryPoint,
          filters: { design_id: input.design_id },
          fields: ["customer_id"],
        })
      ).data?.[0]?.customer_id ||
      undefined;

    const linkedProducts = design.products || [];
    const hasLinkedProduct = linkedProducts.length > 0;

    let product_id: string;
    let variant_id: string;
    let is_new_product = false;

    if (hasLinkedProduct) {
      // Use existing linked product
      const product = linkedProducts[0];
      product_id = product.id;

      // Get product options to create a valid variant
      const productService = container.resolve(Modules.PRODUCT) as any;

      // Build options for the variant based on existing product options
      // Each variant must specify values for all product options
      // We need to add "Custom" as a new value for each option, then use it
      const productOptions = product.options || [];
      const variantOptions: Record<string, string> = {};

      if (productOptions.length > 0) {
        // Each option gains a value that identifies THIS design, so a product can
        // accumulate one variant per design without two of them claiming the same
        // tuple (#1874).
        for (const option of productOptions) {
          const existingValues = option.values?.map((v: any) => v.value) || [];
          const value = designOptionValue(design, existingValues);

          if (!existingValues.includes(value)) {
            await productService.upsertProductOptions([
              {
                id: option.id,
                product_id: product_id,
                title: option.title,
                values: [...existingValues, value],
              },
            ]);
          }

          variantOptions[option.title] = value;
        }
      } else {
        // If product has no options, create a default one
        const value = designOptionValue(design);
        await productService.upsertProductOptions([
          {
            product_id: product_id,
            title: "Type",
            values: [value],
          },
        ]);
        variantOptions["Type"] = value;
      }

      const variantData = {
        product_id: product_id,
        title: `Custom - ${design.name}`,
        sku: `CUSTOM-${design.id}-${Date.now()}`,
        manage_inventory: manageInventory,
        options: variantOptions,
        prices: [
          {
            amount: priceAmount,
            currency_code: currencyCode,
          },
        ],
        metadata: {
          is_custom_design: true,
          design_id: design.id,
        },
      };

      // Use createProductVariantsWorkflow rather than the bare product service.
      // The workflow creates the variant's price_set and links variant ↔ price_set
      // (via createVariantPricingLinkStep) AND auto-creates the inventory item +
      // variant ↔ item link for manage_inventory variants. The bare service skips
      // the price_set link, leaving `variant.prices` undefined so admin's
      // `/products/:id/prices` page crashes on `variant.prices.reduce(...)` (#440).
      // Mirrors the new-product branch below, which already relies on the
      // workflow auto-creating inventory items.
      const { result } = await createProductVariantsWorkflow(container).run({
        input: {
          product_variants: [variantData] as any,
        },
      });

      const createdVariant = result?.[0];
      if (!createdVariant?.id) {
        throw new Error("Failed to create variant for custom design");
      }
      variant_id = createdVariant.id;
    } else {
      // Need to create a new product
      //
      // The caller's channel wins. Only when nobody named one do we fall back
      // to the store default — see `sales_channel_id` for what that fallback
      // silently did to every design quote.
      let salesChannelId = input.sales_channel_id || null;

      if (!salesChannelId) {
        const storeService = container.resolve(Modules.STORE) as any;
        const [store] = await storeService.listStores({});
        salesChannelId = store?.default_sales_channel_id || null;
      }

      if (!salesChannelId) {
        throw new Error("No default sales channel configured for the store");
      }

      // Create new product for this custom design
      // Medusa 2.0 requires options for products with variants
      // #1874's rule applies here too: the option value a variant claims must
      // be the DESIGN's, not the literal "Custom". This branch still hardcoded
      // it, so a product created here and then appended to by a second design
      // ended up with an option list of ["Custom", "<other design>"] — the
      // first variant named after nothing in particular.
      const naming = designProductNaming(design)

      const productInput = {
        // The design's own name, not "Custom Design - <name>". The prefix said
        // nothing the `is_custom_design` metadata does not, and it read badly
        // everywhere the title is shown. `design_type` rides in metadata below.
        title: naming.title,
        description: design.description || `Custom design: ${design.name}`,
        // Draft is not purchasable. A made-to-order product has to be live for
        // the cart an accepted quote builds to be completable at all.
        status: (madeToOrder ? "published" : "draft") as "draft" | "published",
        is_giftcard: false,
        discountable: true,
        thumbnail: gallery.thumbnail,
        images: gallery.images,
        metadata: {
          is_custom_design: true,
          design_id: design.id,
          design_type: design.design_type,
        },
        sales_channels: [{ id: salesChannelId }],
        options: [
          {
            title: naming.optionTitle,
            values: [naming.optionValue],
          },
        ],
        variants: [
          {
            title: naming.variantTitle,
            sku: `CUSTOM-${design.id}`,
            manage_inventory: manageInventory,
            options: {
              [naming.optionTitle]: naming.optionValue,
            },
            prices: [
              {
                amount: priceAmount,
                currency_code: currencyCode,
              },
            ],
          },
        ],
      };

      const { result } = await createProductsWorkflow(container).run({
        input: {
          products: [productInput],
        },
      });

      const createdProduct = result?.[0];
      if (!createdProduct) {
        throw new Error("Failed to create product");
      }

      product_id = createdProduct.id;
      variant_id = createdProduct.variants?.[0]?.id;
      is_new_product = true;

      if (!variant_id) {
        throw new Error("Created product missing variant");
      }

      // createProductsWorkflow auto-creates inventory items when manage_inventory: true

      // Link the new product to the design
      await remoteLink.create({
        [Modules.PRODUCT]: { product_id: product_id },
        [DESIGN_MODULE]: { design_id: design.id },
      });
    }

    // Create design-variant link for order tracking
    await remoteLink.create({
      [DESIGN_MODULE]: { design_id: input.design_id },
      [Modules.PRODUCT]: { product_variant_id: variant_id },
      data: {
        estimated_cost: input.estimated_cost,
        customer_id: customerId,
        created_at: new Date(),
      },
    });

    // Update any existing order line items to reference the new variant/product.
    // This closes the loop: order placed (custom item) → design approved → order items linked.
    //
    // We find orders via two paths:
    //  1. design_order link (created by order-placed subscriber)
    //  2. design_line_item link → cart line item → order_cart (fallback if subscriber hasn't run yet)
    try {
      const orderService = container.resolve(Modules.ORDER) as any;

      const orderIds = new Set<string>();

      // Path 1: design_order link
      try {
        const { data: designOrders } = await query.graph({
          entity: "design_order",
          filters: { design_id: input.design_id },
          fields: ["order_id"],
        });
        for (const link of designOrders || []) {
          if (link.order_id) orderIds.add(link.order_id);
        }
      } catch {
        // Link may not exist yet
      }

      // Path 2: design → line_item link → cart → order_cart
      if (orderIds.size === 0) {
        try {
          const { data: designLineItems } = await query.graph({
            entity: "design_line_item",
            filters: { design_id: input.design_id },
            fields: ["line_item_id"],
          });

          for (const dli of designLineItems || []) {
            // Get the cart that owns this line item via the line item's cart relation
            const { data: lineItems } = await query.graph({
              entity: "line_item",
              filters: { id: dli.line_item_id },
              fields: ["cart.id"],
            }).catch(() => ({ data: [] }));

            const cartId = lineItems?.[0]?.cart?.id;
            if (cartId) {
              // Find the order created from this cart
              const { data: orderCarts } = await query.graph({
                entity: "order_cart",
                filters: { cart_id: cartId },
                fields: ["order_id"],
              }).catch(() => ({ data: [] }));

              for (const oc of orderCarts || []) {
                if (oc.order_id) orderIds.add(oc.order_id);
              }
            }
          }
        } catch {
          // Link traversal failed — non-fatal
        }
      }

      if (orderIds.size > 0) {
        const productService = container.resolve(Modules.PRODUCT) as any;
        const variantDetails = await productService.retrieveProductVariant(variant_id, {
          select: ["id", "sku", "title"],
          relations: ["product"],
        }).catch(() => null);

        for (const orderId of orderIds) {
          try {
            const { data: orderData } = await query.graph({
              entity: "order",
              filters: { id: orderId },
              fields: ["items.*"],
            });

            const items = orderData?.[0]?.items || [];
            for (const item of items) {
              /**
               * Was `item.metadata?.design_id === input.design_id`. The link
               * wins now (#1919), so an item re-pointed to a different design
               * is no longer stamped with THIS design's variant just because
               * its provenance string still names it. `!item.variant_id` still
               * gates it: this only ever fills in a variant that is missing.
               */
              const { designId: itemDesignId } = await resolveLineItemDesignId(
                query,
                { lineItemId: item.id, metadata: item.metadata }
              );
              if (itemDesignId === input.design_id && !item.variant_id) {
                await orderService.updateOrderLineItems(item.id, {
                  variant_id,
                  product_id,
                  variant_sku: variantDetails?.sku || undefined,
                  variant_title: variantDetails?.title || undefined,
                  product_title: variantDetails?.product?.title || item.title,
                });
              }
            }
          } catch {
            // Skip this order — non-fatal
          }
        }
      }
    } catch (e) {
      // Non-fatal — the product was created, order line item update is best-effort
      console.error("[create-product-from-design] Failed to update order line items:", (e as Error).message);
    }

    const output: CreateProductFromDesignOutput = {
      product_id,
      variant_id,
      // What was actually listed. This used to report `estimated_cost` while
      // the row was written at ×100, so the workflow contradicted itself.
      price: priceAmount,
      is_new_product,
    };

    return new StepResponse(output, {
      product_id,
      variant_id,
      design_id: input.design_id,
      is_new_product,
    });
  },
  // Compensation: Clean up on failure
  async (data, { container }) => {
    if (!data) return;

    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link;
    const productService = container.resolve(Modules.PRODUCT) as any;

    // Remove design-variant link
    try {
      await remoteLink.dismiss({
        [DESIGN_MODULE]: { design_id: data.design_id },
        [Modules.PRODUCT]: { product_variant_id: data.variant_id },
      });
    } catch (e) {
      // Link may not exist
    }

    // If we created a new product, delete it
    if (data.is_new_product) {
      try {
        await remoteLink.dismiss({
          [Modules.PRODUCT]: { product_id: data.product_id },
          [DESIGN_MODULE]: { design_id: data.design_id },
        });
      } catch (e) {
        // Link may not exist
      }

      try {
        await productService.deleteProducts([data.product_id]);
      } catch (e) {
        // Product may not exist
      }
    } else {
      // Just delete the variant we created
      try {
        await productService.deleteProductVariants([data.variant_id]);
      } catch (e) {
        // Variant may not exist
      }
    }
  }
);

/**
 * Main workflow: Create Product from Design
 */
export const createProductFromDesignWorkflow = createWorkflow(
  "create-product-from-design",
  (input: CreateProductFromDesignInput) => {
    const result = createProductAndVariantStep(input);
    return new WorkflowResponse(result);
  }
);

export default createProductFromDesignWorkflow;
