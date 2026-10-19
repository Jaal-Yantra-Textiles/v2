import { MedusaStoreRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { ICacheService, INotificationModuleService } from "@medusajs/types"
import { sendProductionStoryEmailWorkflow } from "../../../../../../../workflows/email/workflows/send-production-story-email"
import { buildStoryEmailData } from "../../../production-story-lib/story-email-data"
import { loadDesignStory } from "../../../production-story-lib/load-story"

/** One story per address per design per day: the form cannot be used to flood an inbox. */
const SHARE_TTL_SECONDS = 24 * 60 * 60

/**
 * POST /store/custom/designs/:id/production-story/share
 * Body: { email, product_title?, product_handle?, product_url? }
 *
 * The product page shows only a teaser of how a piece was made (first and
 * last step). A shopper who wants the rest leaves an email here; we email the
 * full story and drop a lead into the admin feed.
 *
 * The email is built server-side from the design id, never from anything the
 * page sends, so this cannot be used to mail arbitrary content. A repeat
 * request for the same address and design within a day answers the same way
 * but sends nothing.
 */
export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req.body ?? {}) as Record<string, any>
  const email = String(body.email ?? "").trim().toLowerCase()
  const productTitle = body.product_title ? String(body.product_title).trim() : ""
  const productHandle = body.product_handle ? String(body.product_handle).trim() : ""
  const productUrl = /^https?:\/\//.test(String(body.product_url ?? ""))
    ? String(body.product_url)
    : ""

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "email is not a valid address")
  }

  const designId = req.params.id
  const loaded = await loadDesignStory(req.scope, designId)
  if (!loaded) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Design not found")
  }

  const cache = req.scope.resolve(Modules.CACHE) as ICacheService
  const dedupeKey = `production-story-share:${designId}:${email}`
  if (await cache.get(dedupeKey)) {
    res.status(200).json({ sent: true })
    return
  }
  await cache.set(dedupeKey, 1, SHARE_TTL_SECONDS)

  const notificationService = req.scope.resolve(
    Modules.NOTIFICATION
  ) as INotificationModuleService
  const title = productTitle || loaded.design.name || "a design"
  await notificationService.createNotifications({
    to: "",
    channel: "feed",
    template: "admin-ui",
    data: {
      title: `Story request: ${title}`,
      description: `${email} asked for the full making story of ${title}.`,
      metadata: {
        kind: "production_story_request",
        design_id: designId,
        product_handle: productHandle || null,
        email,
        received_at: new Date().toISOString(),
      },
    },
  })

  let sent = false
  try {
    await sendProductionStoryEmailWorkflow(req.scope).run({
      input: {
        to: email,
        data: buildStoryEmailData({
          story: loaded.production_story,
          designName: loaded.design.name,
          productTitle,
          productUrl,
        }),
      },
    })
    sent = true
  } catch (error) {
    // Let the shopper retry; the lead is already in the feed.
    await cache.invalidate(dedupeKey)
    logger.error(
      `[production-story-share] email to shopper failed for design ${designId}: ${
        (error as Error)?.message
      }`
    )
  }

  res.status(sent ? 200 : 502).json({ sent })
}
