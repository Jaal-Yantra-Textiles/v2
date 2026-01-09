import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { createProductsWorkflow } from "@medusajs/medusa/core-flows";
import { DESIGN_MODULE } from "../../modules/designs";
import type { Link } from "@medusajs/modules-sdk";

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

type CreateProductFromDesignInput = {
  design_id: string;
  estimated_cost: number;
  customer_id: string;
  currency_code?: string;
};

type CreateProductFromDesignOutput = {
  product_id: string;
  variant_id: string;
  price: number;
  is_new_product: boolean;
};

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
        // For each existing option, add "Custom" as a new value if it doesn't exist
        for (const option of productOptions) {
          const existingValues = option.values?.map((v: any) => v.value) || [];

          // Add "Custom" value if it doesn't exist
          if (!existingValues.includes("Custom")) {
            await productService.upsertProductOptions([
              {
                id: option.id,
                product_id: product_id,
                title: option.title,
                values: [...existingValues, "Custom"],
              },
            ]);
          }

          variantOptions[option.title] = "Custom";
        }
      } else {
        // If product has no options, create a default one
        await productService.upsertProductOptions([
          {
            product_id: product_id,
            title: "Type",
            values: ["Custom"],
          },
        ]);
        variantOptions["Type"] = "Custom";
      }

      const variantData = {
        product_id: product_id,
        title: `Custom - ${design.name}`,
        sku: `CUSTOM-${design.id}-${Date.now()}`,
        manage_inventory: false,
        options: variantOptions,
        prices: [
          {
            amount: Math.round(input.estimated_cost * 100),
            currency_code: currencyCode,
          },
        ],
        metadata: {
          is_custom_design: true,
          design_id: design.id,
        },
      };

      const variant = await productService.createProductVariants(variantData);
      variant_id = variant.id;
    } else {
      // Need to create a new product
      const storeService = container.resolve(Modules.STORE) as any;
      const [store] = await storeService.listStores({});

      if (!store?.default_sales_channel_id) {
        throw new Error("No default sales channel configured for the store");
      }

      // Create new product for this custom design
      // Medusa 2.0 requires options for products with variants
      const productInput = {
        title: `Custom Design - ${design.name}`,
        description: design.description || `Custom design: ${design.name}`,
        status: "published" as const,
        is_giftcard: false,
        discountable: true,
        thumbnail: design.thumbnail_url,
        images: design.thumbnail_url
          ? [{ url: design.thumbnail_url }]
          : [],
        metadata: {
          is_custom_design: true,
          design_id: design.id,
          design_type: design.design_type,
        },
        sales_channels: [{ id: store.default_sales_channel_id }],
        options: [
          {
            title: "Type",
            values: ["Custom"],
          },
        ],
        variants: [
          {
            title: "Custom Design",
            sku: `CUSTOM-${design.id}`,
            manage_inventory: false,
            options: {
              Type: "Custom",
            },
            prices: [
              {
                amount: Math.round(input.estimated_cost * 100),
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
        customer_id: input.customer_id,
        created_at: new Date(),
      },
    });

    const output: CreateProductFromDesignOutput = {
      product_id,
      variant_id,
      price: input.estimated_cost,
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
