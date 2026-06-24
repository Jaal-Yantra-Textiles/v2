import { z } from "zod"

/**
 * Bind a media file to a raw material.
 * Either bind an existing raw material (`raw_material_id`) OR create a new one
 * inline (`create`, for unrecorded pieces). `media_url` defaults to the media
 * file's own `file_path` on the server.
 */
export const BindRawMaterialSchema = z
  .object({
    raw_material_id: z.string().optional(),
    // Optional explicit url; defaults to the media file's file_path server-side.
    media_url: z.string().optional(),
    // Set/confirm SKU on the linked inventory item (admin already has the id
    // from the raw-materials list response).
    sku: z.string().optional(),
    inventory_item_id: z.string().optional(),
    // Inline create for an unrecorded piece (minimal: name + optional sku).
    create: z
      .object({
        name: z.string().min(1),
        composition: z.string().optional(),
        sku: z.string().optional(),
      })
      .optional(),
  })
  .refine((d) => Boolean(d.raw_material_id) || Boolean(d.create), {
    message: "Provide either raw_material_id or create",
  })

export type BindRawMaterialType = z.infer<typeof BindRawMaterialSchema>

export const UnbindRawMaterialSchema = z.object({
  raw_material_id: z.string().min(1),
  media_url: z.string().optional(),
})

export type UnbindRawMaterialType = z.infer<typeof UnbindRawMaterialSchema>
