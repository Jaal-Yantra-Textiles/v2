import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils"
import { getPersonResourceDefinition } from "../../../../resources/registry"

const resolveResourceOrThrow = (resourceKey: string) => {
  const resource = getPersonResourceDefinition(resourceKey)

  if (!resource) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unsupported person resource "${resourceKey}"`,
    )
  }

  return resource
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const {
    id: personId,
    resource: resourceKey,
    resourceId,
  } = req.params
  const resource = resolveResourceOrThrow(resourceKey)

  if (!resource.handlers.retrieve) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Retrieving is not supported for resource "${resourceKey}"`,
    )
  }

  const retrieved = await resource.handlers.retrieve({
    scope: req.scope,
    personId,
    resourceId,
  })

  res.status(200).json({
    [resource.itemKey]: retrieved,
  })
}

export const PATCH = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const {
    id: personId,
    resource: resourceKey,
    resourceId,
  } = req.params
  const resource = resolveResourceOrThrow(resourceKey)

  if (!resource.handlers.update) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Updating is not supported for resource "${resourceKey}"`,
    )
  }

  const payload = resource.validators?.update
    ? resource.validators.update.parse(req.body)
    : req.body

  const updated = await resource.handlers.update({
    scope: req.scope,
    personId,
    resourceId,
    payload,
  })

  res.status(200).json({
    [resource.itemKey]: updated,
  })
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const {
    id: personId,
    resource: resourceKey,
    resourceId,
  } = req.params
  const resource = resolveResourceOrThrow(resourceKey)

  if (!resource.handlers.delete) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Deletion is not supported for resource "${resourceKey}"`,
    )
  }

  await resource.handlers.delete({
    scope: req.scope,
    personId,
    resourceId,
  })

  res.status(200).json({
    id: resourceId,
    person_id: personId,
    resource: resourceKey,
    deleted: true,
  })
}
