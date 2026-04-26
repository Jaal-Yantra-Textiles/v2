import PersonService from "../../../../modules/person/service"
import { PERSON_MODULE } from "../../../../modules/person"
import { addressSchema } from "../[id]/addresses/validators"
import { contactSchema } from "../[id]/contacts/validators"
import {
  tagSchema,
  updateTagSchema,
} from "../[id]/tags/validators"
import { PERSON_RESOURCE_META, PersonResourceKey } from "./meta"
import { PersonResourceDefinition, PersonResourceRegistry } from "./types"
import managePersonResourceWorkflow from "../../../../workflows/persons/manage-person-resource"

const buildDefinition = (
  key: PersonResourceKey,
  definition: Omit<PersonResourceDefinition, "key" | "listKey" | "itemKey" | "pathSegment">,
): PersonResourceDefinition => {
  const meta = PERSON_RESOURCE_META[key]
  return {
    key,
    listKey: meta.listKey,
    itemKey: meta.itemKey,
    pathSegment: meta.pathSegment,
    ...definition,
  }
}

export const PERSON_RESOURCE_REGISTRY: PersonResourceRegistry = {
  addresses: buildDefinition("addresses", {
    validators: {
      create: addressSchema,
      update: addressSchema.partial(),
    },
    handlers: {
      async list({ scope, personId }) {
        const { result } = await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "addresses",
            action: "list",
            personId,
          },
        })
        return result
      },
      async create({ scope, personId, payload }) {
        const { result } = await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "addresses",
            action: "create",
            personId,
            payload,
          },
        })
        return result
      },
      async retrieve({ scope, resourceId, personId }) {
        const { result } = await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "addresses",
            action: "retrieve",
            personId,
            resourceId,
          },
        })
        return result
      },
      async update({ scope, resourceId, payload, personId }) {
        const { result } = await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "addresses",
            action: "update",
            personId,
            resourceId,
            payload,
          },
        })
        return result
      },
      async delete({ scope, resourceId, personId }) {
        await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "addresses",
            action: "delete",
            personId,
            resourceId,
          },
        })
      },
    },
  }),
  contacts: buildDefinition("contacts", {
    validators: {
      create: contactSchema,
      update: contactSchema.partial(),
    },
    handlers: {
      async list({ scope, personId }) {
        const { result } = await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "contacts",
            action: "list",
            personId,
          },
        })
        return result
      },
      async create({ scope, personId, payload }) {
        const { result } = await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "contacts",
            action: "create",
            personId,
            payload,
          },
        })
        return result
      },
      async retrieve({ scope, resourceId, personId }) {
        const { result } = await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "contacts",
            action: "retrieve",
            personId,
            resourceId,
          },
        })
        return result
      },
      async update({ scope, resourceId, payload, personId }) {
        const { result } = await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "contacts",
            action: "update",
            personId,
            resourceId,
            payload,
          },
        })
        return result
      },
      async delete({ scope, resourceId, personId }) {
        await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "contacts",
            action: "delete",
            personId,
            resourceId,
          },
        })
      },
    },
  }),
  tags: buildDefinition("tags", {
    validators: {
      create: tagSchema,
      update: updateTagSchema,
    },
    handlers: {
      async list({ scope, personId }) {
        const { result } = await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "tags",
            action: "list",
            personId,
          },
        })
        return result
      },
      async create({ scope, personId, payload }) {
        const { result } = await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "tags",
            action: "create",
            personId,
            payload,
          },
        })
        return result
      },
      async retrieve({ scope, resourceId, personId }) {
        const { result } = await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "tags",
            action: "retrieve",
            personId,
            resourceId,
          },
        })
        return result
      },
      async update({ scope, resourceId, payload, personId }) {
        const { result } = await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "tags",
            action: "update",
            personId,
            resourceId,
            payload,
          },
        })
        return result
      },
      async delete({ scope, resourceId, personId }) {
        await managePersonResourceWorkflow(scope).run({
          input: {
            resource: "tags",
            action: "delete",
            personId,
            resourceId,
          },
        })
      },
    },
  }),
}

export const getPersonResourceDefinition = (resource: string) =>
  PERSON_RESOURCE_REGISTRY[resource as keyof typeof PERSON_RESOURCE_REGISTRY]
