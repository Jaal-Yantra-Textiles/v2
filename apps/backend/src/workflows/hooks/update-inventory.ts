import { createInventoryItemsWorkflow } from "@medusajs/medusa/core-flows"
import { StepResponse } from "@medusajs/framework/workflows-sdk"

// createProductsWorkflow.hooks.productsCreated(
//   (async ({ products, additional_data }, { container }) => {
//     if (!additional_data?.brand_id) {
//       return new StepResponse([], [])
//     }

//     const brandModuleService: BrandModuleService = container.resolve(
//       BRAND_MODULE
//     )
//     // if the brand doesn't exist, an error is thrown.
//     await brandModuleService.retrieveBrand(additional_data.brand_id as string)

//     // TODO link brand to product
//   })
// )


