/**
 * This workflow creates a link between the products and the designs
 * So, say we have already defined the designs and products are already created
 * then we can link the products with the designs
 * This workflow covers the need to link the products with the designs automatically when 
 * the design moves to commerce ready state.
 * 
 * Also covers the unlink of the products with the designs automatically when 
 * the design moves to any other state.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { LinkDefinition } from "@medusajs/framework/types"
import { DESIGN_MODULE } from "../../modules/designs"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { Modules } from "@medusajs/framework/utils"
import DesignService from "../../modules/designs/service"
import type { IProductModuleService } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"

// Input types for the workflows
type LinkProductDesignInput = {
  productId: string
  designId: string
}

type UnlinkProductDesignInput = {
  productId: string
  designId: string
}

type LinkMultipleProductsDesignInput = {
  productIds: string[]
  designId: string
}

type ValidateProductDesignExistenceInput = {
  productId: string
  designId: string
}

type ValidateMultipleProductsDesignExistenceInput = {
  productIds: string[]
  designId: string
}

/**
 * Step to validate that both product and design exist before linking
 */
export const validateProductDesignExistenceStep = createStep(
  "validate-product-design-existence-step",
  async (input: ValidateProductDesignExistenceInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE)
    const productService = container.resolve(Modules.PRODUCT) as IProductModuleService

    // Check if design exists
    try {
      const design = await designService.retrieveDesign(input.designId)
      if (!design) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Design with id ${input.designId} was not found`
        )
      }
    } catch (error) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Design with id ${input.designId} was not found`
      )
    }

    // Check if product exists
    try {
      const product = await productService.retrieveProduct(input.productId)
      if (!product) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Product with id ${input.productId} was not found`
        )
      }
    } catch (error) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Product with id ${input.productId} was not found`
      )
    }

    return new StepResponse({ validated: true })
  }
)

/**
 * Step to validate that design and multiple products exist before linking
 */
export const validateMultipleProductsDesignExistenceStep = createStep(
  "validate-multiple-products-design-existence-step",
  async (input: ValidateMultipleProductsDesignExistenceInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE)
    const productService = container.resolve(Modules.PRODUCT) as IProductModuleService

    // Check if design exists
    try {
      const design = await designService.retrieveDesign(input.designId)
      if (!design) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Design with id ${input.designId} was not found`
        )
      }
    } catch (error) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Design with id ${input.designId} was not found`
      )
    }

    // Check if all products exist
    for (const productId of input.productIds) {
      try {
        const product = await productService.retrieveProduct(productId)
        if (!product) {
          throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            `Product with id ${productId} was not found`
          )
        }
      } catch (error) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Product with id ${productId} was not found`
        )
      }
    }

    return new StepResponse({ validated: true })
  }
)

/**
 * Step to create a link between a product and a design
 */
export const createProductDesignLinkStep = createStep(
  "create-product-design-link-step",
  async (input: LinkProductDesignInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const links: LinkDefinition[] = []

    links.push({
      [Modules.PRODUCT]: {
        product_id: input.productId,
      },
      [DESIGN_MODULE]: {
        design_id: input.designId,
      },
    })

    const createdLinks = await remoteLink.create(links)
    return new StepResponse(createdLinks, { productId: input.productId, designId: input.designId })
  },
  async (input: { productId: string; designId: string }, { container }) => {
    // Compensation: remove the link if the step needs to be rolled back
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.dismiss([
      {
        [Modules.PRODUCT]: {
          product_id: input.productId,
        },
        [DESIGN_MODULE]: {
          design_id: input.designId,
        },
      },
    ])
  }
)

/**
 * Step to remove a link between a product and a design
 */
export const removeProductDesignLinkStep = createStep(
  "remove-product-design-link-step",
  async (input: UnlinkProductDesignInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    await remoteLink.dismiss([
      {
        [Modules.PRODUCT]: {
          product_id: input.productId,
        },
        [DESIGN_MODULE]: {
          design_id: input.designId,
        },
      },
    ])

    return new StepResponse({ success: true })
  }
)

/**
 * Step to create links between multiple products and a design
 */
export const createMultipleProductDesignLinksStep = createStep(
  "create-multiple-product-design-links-step",
  async (input: LinkMultipleProductsDesignInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const links: LinkDefinition[] = []

    for (const productId of input.productIds) {
      links.push({
        [Modules.PRODUCT]: {
          product_id: productId,
        },
        [DESIGN_MODULE]: {
          design_id: input.designId,
        },
      })
    }

    const createdLinks = await remoteLink.create(links)
    return new StepResponse(createdLinks, { productIds: input.productIds, designId: input.designId })
  },
  async (input: { productIds: string[]; designId: string }, { container }) => {
    // Compensation: remove all the links if the step needs to be rolled back
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const linksToRemove = input.productIds.map((productId) => ({
      [Modules.PRODUCT]: {
        product_id: productId,
      },
      [DESIGN_MODULE]: {
        design_id: input.designId,
      },
    }))
    await remoteLink.dismiss(linksToRemove)
  }
)

/**
 * Workflow to link a single product with a design
 */
export const linkProductWithDesignWorkflow = createWorkflow(
  "link-product-with-design",
  (input: LinkProductDesignInput) => {
    // First validate that both product and design exist
    const validationStep = validateProductDesignExistenceStep(input)
    
    // Then create the link
    const linkStep = createProductDesignLinkStep(input)
    
    return new WorkflowResponse(linkStep)
  }
)

/**
 * Workflow to unlink a product from a design
 */
export const unlinkProductFromDesignWorkflow = createWorkflow(
  "unlink-product-from-design",
  (input: UnlinkProductDesignInput) => {
    const unlinkStep = removeProductDesignLinkStep(input)
    return new WorkflowResponse(unlinkStep)
  }
)

/**
 * Workflow to link multiple products with a design
 */
export const linkMultipleProductsWithDesignWorkflow = createWorkflow(
  "link-multiple-products-with-design",
  (input: LinkMultipleProductsDesignInput) => {
    // First validate that design and all products exist
    const validationStep = validateMultipleProductsDesignExistenceStep(input)
    
    // Then create the links
    const linkStep = createMultipleProductDesignLinksStep(input)
    
    return new WorkflowResponse(linkStep)
  }
)
