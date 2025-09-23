/**
 * Workflows to link/unlink products with people (direct association)
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { LinkDefinition } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import PersonService from "../../modules/person/service"
import { PERSON_MODULE } from "../../modules/person"

// Inputs
export type LinkProductPersonInput = {
  productId: string
  personId: string
}

export type UnlinkProductPersonInput = {
  productId: string
  personId: string
}

// Steps
export const validateProductPersonExistenceStep = createStep(
  "validate-product-person-existence-step",
  async (input: LinkProductPersonInput, { container }) => {
    const productService = container.resolve(Modules.PRODUCT)
    const personService: PersonService = container.resolve(PERSON_MODULE)

    // Validate product
    try {
      const product = await productService.retrieveProduct(input.productId)
      if (!product) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Product with id ${input.productId} was not found`
        )
      }
    } catch (e) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Product with id ${input.productId} was not found`
      )
    }

    // Validate person
    try {
      const person = await personService.retrievePerson(input.personId)
      if (!person) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Person with id ${input.personId} was not found`
        )
      }
    } catch (e) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Person with id ${input.personId} was not found`
      )
    }

    return new StepResponse({ validated: true })
  }
)

export const createProductPersonLinkStep = createStep(
  "create-product-person-link-step",
  async (input: LinkProductPersonInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    const links: LinkDefinition[] = [
      {
        [Modules.PRODUCT]: { product_id: input.productId },
        [PERSON_MODULE]: { person_id: input.personId },
      },
    ]

    const createdLinks = await remoteLink.create(links)
    return new StepResponse(createdLinks, { productId: input.productId, personId: input.personId })
  },
  async (input: { productId: string; personId: string }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.dismiss([
      {
        [Modules.PRODUCT]: { product_id: input.productId },
        [PERSON_MODULE]: { person_id: input.personId },
      },
    ])
  }
)

export const removeProductPersonLinkStep = createStep(
  "remove-product-person-link-step",
  async (input: UnlinkProductPersonInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.dismiss([
      {
        [Modules.PRODUCT]: { product_id: input.productId },
        person: { person_id: input.personId },
      },
    ])
    return new StepResponse({ success: true })
  }
)

// Workflows
export const linkProductWithPersonWorkflow = createWorkflow(
  "link-product-with-person",
  (input: LinkProductPersonInput) => {
    validateProductPersonExistenceStep(input)
    const linkStep = createProductPersonLinkStep(input)
    return new WorkflowResponse(linkStep)
  }
)

export const unlinkProductFromPersonWorkflow = createWorkflow(
  "unlink-product-from-person",
  (input: UnlinkProductPersonInput) => {
    const unlinkStep = removeProductPersonLinkStep(input)
    return new WorkflowResponse(unlinkStep)
  }
)
