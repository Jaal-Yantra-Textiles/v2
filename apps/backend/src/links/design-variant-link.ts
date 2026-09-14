/**
 * Design-Variant Link
 *
 * Links a Design to a ProductVariant for custom/personalized products.
 * This enables:
 * - Finding the design from an order line item (via variant)
 * - Triggering production runs when an order containing a custom design is placed
 * - Tracking which variants were created from which designs
 *
 * Unlike product-design-link (many-to-many at product level), a VARIANT has
 * exactly one design — but a design may back MANY variants.
 *
 * 🔴 Both sides used to be `isList: false`, which made the second variant for a
 * design THROW at write time. A design with sizes S/M/L, or two colourways,
 * simply could not be represented: the minter created one variant and the rest
 * were unrepresentable. #1874
 *
 * That constraint was also load-bearing by accident. Every reader took
 * `design_product_variant[0]` and was correct only because the table could not
 * hold a second row. Opening this up turns each of those into a lottery, so the
 * readers that decide where physical goods go now refuse when a design has more
 * than one variant and nothing says which was made — see
 * `lib/run-variant.ts#pickDesignVariant`.
 */
import { defineLink } from "@medusajs/framework/utils";
import ProductModule from "@medusajs/medusa/product";
import DesignModule from "../modules/designs";

export default defineLink(
  {
    linkable: DesignModule.linkable.design,
    isList: false, // One design per variant
  },
  {
    linkable: ProductModule.linkable.productVariant,
    // A design backs many variants (sizes, colourways). The design side stays
    // `isList: false`: a variant is still made from exactly one design.
    isList: true,
    field: "product_variants",
  },
  {
    database: {
      extraColumns: {
        // Store the estimated cost at the time of variant creation
        estimated_cost: { type: "decimal", nullable: true },
        // Customer who created this custom variant
        customer_id: { type: "text", nullable: true },
        // Timestamp when the variant was created from the design
        created_at: { type: "datetime", nullable: true },
      },
    },
  }
);
