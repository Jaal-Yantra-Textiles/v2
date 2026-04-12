import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

interface LinkWhatsAppBody {
  phone_number: string
}

/**
 * POST /admin/users/:id/whatsapp-link
 *
 * Links a WhatsApp phone number to an admin user by storing it in user metadata.
 * This enables the admin to use WhatsApp commands.
 */
export const POST = async (
  req: MedusaRequest<LinkWhatsAppBody>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const { phone_number } = req.validatedBody || req.body as any

  if (!phone_number) {
    return res.status(400).json({ message: "phone_number is required" })
  }

  const userService = req.scope.resolve(Modules.USER) as any

  // Get existing user
  const user = await userService.retrieveUser(id)
  if (!user) {
    return res.status(404).json({ message: "User not found" })
  }

  // Update metadata with whatsapp_number
  const existingMetadata = (user.metadata as Record<string, any>) || {}
  await userService.updateUsers({
    id,
    metadata: {
      ...existingMetadata,
      whatsapp_number: phone_number,
      whatsapp_linked_at: new Date().toISOString(),
    },
  })

  res.json({
    user: {
      id: user.id,
      email: user.email,
      whatsapp_number: phone_number,
      whatsapp_linked: true,
    },
  })
}

/**
 * DELETE /admin/users/:id/whatsapp-link
 *
 * Removes the WhatsApp phone number from an admin user.
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const userService = req.scope.resolve(Modules.USER) as any
  const user = await userService.retrieveUser(id)
  if (!user) {
    return res.status(404).json({ message: "User not found" })
  }

  const existingMetadata = (user.metadata as Record<string, any>) || {}
  const { whatsapp_number, whatsapp_linked_at, ...restMetadata } = existingMetadata

  await userService.updateUsers({
    id,
    metadata: restMetadata,
  })

  res.json({
    user: {
      id: user.id,
      email: user.email,
      whatsapp_linked: false,
    },
  })
}

/**
 * GET /admin/users/:id/whatsapp-link
 *
 * Returns the WhatsApp link status for an admin user.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const userService = req.scope.resolve(Modules.USER) as any
  const user = await userService.retrieveUser(id)
  if (!user) {
    return res.status(404).json({ message: "User not found" })
  }

  const metadata = (user.metadata as Record<string, any>) || {}

  res.json({
    whatsapp_linked: !!metadata.whatsapp_number,
    whatsapp_number: metadata.whatsapp_number || null,
    whatsapp_linked_at: metadata.whatsapp_linked_at || null,
  })
}
