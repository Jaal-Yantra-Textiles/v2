/**
 * Design-Variant Link
 *
 * Links a Design to a ProductVariant for custom/personalized products.
 * This enables:
 * - Finding the design from an order line item (via variant)
 * - Triggering production runs when an order containing a custom design is placed
 * - Tracking which variants were created from which designs
 *
 * Unlike product-design-link (many-to-many at product level),
 * this is a one-to-one link at the variant level for custom designs.
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
    isList: false, // One variant per design (for custom products)
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
