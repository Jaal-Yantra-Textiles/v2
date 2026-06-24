/**
 * Route: /admin/medias/file/:id/raw-material
 *
 * Manual photo → raw-material binding tool (#730). Human-toggled, no AI.
 *
 *  - GET    : read the current binding stamped on the media file (or null).
 *  - POST   : bind this media file to a raw material — appends the media url
 *             into `raw_materials.media` ({ files: string[] }, idempotent) so the
 *             photo renders everywhere a raw material is shown (#728 read side).
 *             Optionally creates a new raw material inline, and/or sets the SKU
 *             on the linked inventory item.
 *  - DELETE : unbind — remove the url from `raw_materials.media` and clear the
 *             media file's back-reference.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { MEDIA_MODULE } from "../../../../../../modules/media"
import { RAW_MATERIAL_MODULE } from "../../../../../../modules/raw_material"
import { createRawMaterialWorkflow } from "../../../../../../workflows/raw-materials/create-raw-material"
import {
  appendMediaFile,
  removeMediaFile,
  stampBinding,
  clearBinding,
  readBinding,
} from "../../../../../../workflows/media/lib/media-binding"
import {
  BindRawMaterialSchema,
  UnbindRawMaterialSchema,
} from "./validators"

const resolveServices = (req: MedusaRequest) => ({
  logger: req.scope.resolve(ContainerRegistrationKeys.LOGGER) as any,
  mediaService: req.scope.resolve(MEDIA_MODULE) as any,
  rawService: req.scope.resolve(RAW_MATERIAL_MODULE) as any,
  inventoryService: req.scope.resolve(Modules.INVENTORY) as any,
})

const getMediaFileOr404 = async (mediaService: any, id: string) => {
  const file = await mediaService.retrieveMediaFile(id).catch(() => null)
  if (!file) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Media file ${id} not found`
    )
  }
  return file
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params as { id: string }
  const { mediaService } = resolveServices(req)
  const file = await getMediaFileOr404(mediaService, id)

  return res.status(200).json({
    media_file_id: id,
    media_url: file.file_path,
    binding: readBinding(file.metadata),
  })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params as { id: string }

  const parsed = BindRawMaterialSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => i.message).join(", ")
    )
  }
  const body = parsed.data

  const { logger, mediaService, rawService, inventoryService } =
    resolveServices(req)

  const file = await getMediaFileOr404(mediaService, id)
  const mediaUrl = (body.media_url || file.file_path || "").trim()
  if (!mediaUrl) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Media file has no url to bind"
    )
  }

  let rawMaterialId = body.raw_material_id
  let createdInventoryItemId: string | undefined
  let appliedSku: string | null = null

  // --- create-new path (unrecorded piece): inventory item + raw material ---
  if (!rawMaterialId && body.create) {
    const [invItem] = await inventoryService.createInventoryItems([
      {
        sku: body.create.sku || undefined,
        title: body.create.name,
      },
    ])
    createdInventoryItemId = invItem.id
    appliedSku = invItem.sku ?? body.create.sku ?? null

    const { result } = await createRawMaterialWorkflow(req.scope).run({
      input: {
        inventoryId: invItem.id,
        rawMaterialData: {
          name: body.create.name,
          // description + composition are required (non-nullable) on the model.
          description: body.create.name,
          composition: body.create.composition || "Unspecified",
          media: { files: [mediaUrl] },
        },
      },
    })
    // Workflow returns [rawMaterialResult, linkResult, skuResult]
    rawMaterialId = (result?.[0] as any)?.id
    if (!rawMaterialId) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to create raw material for binding"
      )
    }
  }

  if (!rawMaterialId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "raw_material_id is required to bind"
    )
  }

  const raw = await rawService
    .retrieveRawMaterial(rawMaterialId)
    .catch(() => null)
  if (!raw) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Raw material ${rawMaterialId} not found`
    )
  }

  // --- idempotent append into raw_materials.media ---
  const nextMedia = appendMediaFile(raw.media, mediaUrl)
  await rawService.updateRawMaterials({ id: rawMaterialId, media: nextMedia })

  // --- optional SKU set/confirm on an existing linked inventory item ---
  if (body.sku && body.inventory_item_id) {
    await inventoryService.updateInventoryItems([
      { id: body.inventory_item_id, sku: body.sku },
    ])
    appliedSku = body.sku
  }

  // --- stamp display back-reference on the media file ---
  await mediaService.updateMediaFiles({
    id,
    metadata: stampBinding(file.metadata, {
      bound_raw_material_id: rawMaterialId,
      bound_raw_material_name: raw.name ?? null,
      bound_sku: appliedSku,
    }),
  })

  logger?.info?.(
    `Bound media ${id} -> raw_material ${rawMaterialId} (${mediaUrl})`
  )

  return res.status(200).json({
    bound: true,
    media_file_id: id,
    media_url: mediaUrl,
    raw_material_id: rawMaterialId,
    raw_material: { ...raw, media: nextMedia },
    inventory_item_id: createdInventoryItemId ?? body.inventory_item_id ?? null,
    sku: appliedSku,
  })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params as { id: string }

  const parsed = UnbindRawMaterialSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => i.message).join(", ")
    )
  }
  const body = parsed.data

  const { logger, mediaService, rawService } = resolveServices(req)

  const file = await getMediaFileOr404(mediaService, id)
  const mediaUrl = (body.media_url || file.file_path || "").trim()

  const raw = await rawService
    .retrieveRawMaterial(body.raw_material_id)
    .catch(() => null)
  if (raw) {
    const nextMedia = removeMediaFile(raw.media, mediaUrl)
    await rawService.updateRawMaterials({
      id: body.raw_material_id,
      media: nextMedia,
    })
  }

  await mediaService.updateMediaFiles({
    id,
    metadata: clearBinding(file.metadata),
  })

  logger?.info?.(
    `Unbound media ${id} from raw_material ${body.raw_material_id}`
  )

  return res.status(200).json({
    unbound: true,
    media_file_id: id,
    raw_material_id: body.raw_material_id,
  })
}
