import {
  StepResponse,
  WorkflowResponse,
  createStep,
  createWorkflow,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

import PersonService from "../../modules/person/service"
import { PERSON_MODULE } from "../../modules/person"
import { PersonResourceKey } from "../../api/admin/persons/resources/meta"

type ManagePersonResourceAction = "list" | "create" | "retrieve" | "update" | "delete"

type ManagePersonResourceInput = {
  resource: PersonResourceKey
  action: ManagePersonResourceAction
  personId?: string
  resourceId?: string
  payload?: Record<string, any>
}

type OperationHandler = (
  service: PersonService,
  input: ManagePersonResourceInput,
) => Promise<any>

type ResourceOperationHandlers = Partial<
  Record<ManagePersonResourceAction, OperationHandler>
>

const ensureCondition = (condition: any, message: string) => {
  if (!condition) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
  }
}

const withPersonId = (input: ManagePersonResourceInput) => {
  ensureCondition(input.personId, "personId is required for this operation")
  return input.personId as string
}

const withResourceId = (input: ManagePersonResourceInput) => {
  ensureCondition(input.resourceId, "resourceId is required for this operation")
  return input.resourceId as string
}

const withPayload = (input: ManagePersonResourceInput) => {
  ensureCondition(input.payload, "payload is required for this operation")
  return input.payload as Record<string, any>
}

const ensurePersonExists = async (service: PersonService, personId: string) => {
  try {
    await service.retrievePerson(personId)
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Person with id "${personId}" was not found`,
    )
  }
}

const ensureAddressBelongsToPerson = async (
  service: PersonService,
  personId: string,
  addressId: string,
) => {
  try {
    const address = await service.retrieveAddress(addressId)

    if (!address || address.person_id !== personId) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Address with id "${addressId}" not found for person "${personId}"`,
      )
    }

    return address
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Address with id "${addressId}" not found for person "${personId}"`,
    )
  }
}

const ensureContactBelongsToPerson = async (
  service: PersonService,
  personId: string,
  contactId: string,
) => {
  try {
    const contact = await service.retrieveContactDetail(contactId)

    if (!contact || contact.person_id !== personId) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Contact with id "${contactId}" not found for person "${personId}"`,
      )
    }

    return contact
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Contact with id "${contactId}" not found for person "${personId}"`,
    )
  }
}

const ensureTagBelongsToPerson = async (
  service: PersonService,
  personId: string,
  tagId: string,
) => {
  try {
    const tag = await service.retrieveTag(tagId)

    if (!tag || tag.person_id !== personId) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Tag with id "${tagId}" not found for person "${personId}"`,
      )
    }

    return tag
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Tag with id "${tagId}" not found for person "${personId}"`,
    )
  }
}

const ADDRESS_OPERATIONS: ResourceOperationHandlers = {
  list: async (service, input) => {
    const personId = withPersonId(input)
    await ensurePersonExists(service, personId)
    const [items, count] = await service.listAndCountAddresses({
      person_id: personId,
    })
    return { items, count }
  },
  create: async (service, input) => {
    const personId = withPersonId(input)
    await ensurePersonExists(service, personId)
    const payload = withPayload(input)
    return service.createAddresses({
      ...payload,
      person_id: personId,
    })
  },
  retrieve: async (service, input) => {
    const personId = withPersonId(input)
    const resourceId = withResourceId(input)
    return ensureAddressBelongsToPerson(service, personId, resourceId)
  },
  update: async (service, input) => {
    const personId = withPersonId(input)
    const resourceId = withResourceId(input)
    const payload = withPayload(input)
    await ensureAddressBelongsToPerson(service, personId, resourceId)
    const [address] = await service.updateAddresses({
      selector: { id: resourceId },
      data: payload,
    })
    return address
  },
  delete: async (service, input) => {
    const personId = withPersonId(input)
    const resourceId = withResourceId(input)
    await ensureAddressBelongsToPerson(service, personId, resourceId)
    await service.deleteAddresses(resourceId)
    return { success: true }
  },
}

const CONTACT_OPERATIONS: ResourceOperationHandlers = {
  list: async (service, input) => {
    const personId = withPersonId(input)
    await ensurePersonExists(service, personId)
    const [items, count] = await service.listAndCountContactDetails({
      person_id: personId,
    })
    return { items, count }
  },
  create: async (service, input) => {
    const personId = withPersonId(input)
    await ensurePersonExists(service, personId)
    const payload = withPayload(input)
    return service.createContactDetails({
      ...payload,
      person_id: personId,
    })
  },
  retrieve: async (service, input) => {
    const personId = withPersonId(input)
    const resourceId = withResourceId(input)
    return ensureContactBelongsToPerson(service, personId, resourceId)
  },
  update: async (service, input) => {
    const personId = withPersonId(input)
    const resourceId = withResourceId(input)
    const payload = withPayload(input)
    await ensureContactBelongsToPerson(service, personId, resourceId)
    const [contact] = await service.updateContactDetails({
      selector: { id: resourceId },
      data: payload,
    })
    return contact
  },
  delete: async (service, input) => {
    const personId = withPersonId(input)
    const resourceId = withResourceId(input)
    await ensureContactBelongsToPerson(service, personId, resourceId)
    await service.deleteContactDetails(resourceId)
    return { success: true }
  },
}

const TAG_OPERATIONS: ResourceOperationHandlers = {
  list: async (service, input) => {
    const personId = withPersonId(input)
    await ensurePersonExists(service, personId)
    const [items, count] = await service.listAndCountTags({
      person_id: personId,
    })
    return { items, count }
  },
  create: async (service, input) => {
    const personId = withPersonId(input)
    await ensurePersonExists(service, personId)
    const payload = withPayload(input)
    return service.createTags({
      ...payload,
      person_id: personId,
    })
  },
  retrieve: async (service, input) => {
    const personId = withPersonId(input)
    const resourceId = withResourceId(input)
    return ensureTagBelongsToPerson(service, personId, resourceId)
  },
  update: async (service, input) => {
    const personId = withPersonId(input)
    const resourceId = withResourceId(input)
    const payload = withPayload(input)
    await ensureTagBelongsToPerson(service, personId, resourceId)
    const [tag] = await service.updateTags({
      selector: { id: resourceId },
      data: payload,
    })
    return tag
  },
  delete: async (service, input) => {
    const personId = withPersonId(input)
    const resourceId = withResourceId(input)
    await ensureTagBelongsToPerson(service, personId, resourceId)
    await service.deleteTags(resourceId)
    return { success: true }
  },
}

const RESOURCE_OPERATIONS: Record<PersonResourceKey, ResourceOperationHandlers> = {
  addresses: ADDRESS_OPERATIONS,
  contacts: CONTACT_OPERATIONS,
  tags: TAG_OPERATIONS,
}

const managePersonResourceStep = createStep(
  "manage-person-resource",
  async (input: ManagePersonResourceInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE)
    const resourceHandlers = RESOURCE_OPERATIONS[input.resource]

    if (!resourceHandlers) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unsupported person resource: ${input.resource}`,
      )
    }

    const handler = resourceHandlers[input.action]

    if (!handler) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unsupported action "${input.action}" for resource "${input.resource}"`,
      )
    }

    const data = await handler(personService, input)
    return new StepResponse(data)
  },
)

export const managePersonResourceWorkflow = createWorkflow(
  {
    name:"manage-person-resource",
    store: true
  },
  (input: ManagePersonResourceInput) => {
    const result = managePersonResourceStep(input)
    return new WorkflowResponse(result)
  },
)

export default managePersonResourceWorkflow
