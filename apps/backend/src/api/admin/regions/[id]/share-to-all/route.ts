import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import propagateRegionToPartnersWorkflow from "../../../../../workflows/regions/propagate-region-to-partners"

/**
 * POST /admin/regions/:id/share-to-all
 *
 * Manually fire the same propagation the `region.created` subscriber
 * runs. Useful when admin wants to force-share an existing region to
 * partners that aren't currently linked (e.g. after a partner was
 * added and missed the original event), or to opt into the FX fanout
 * pass for a region.
 *
 * Body:
 *   {
 *     trigger_fanout?: boolean,   // default false
 *     partner_ids?: string[]       // default all partners
 *   }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const regionId = req.params.id
  const body = (req.body ?? {}) as {
    trigger_fanout?: boolean
    partner_ids?: string[]
  }

  const { result } = await propagateRegionToPartnersWorkflow(req.scope).run({
    input: {
      region_id: regionId,
      trigger_fanout: !!body.trigger_fanout,
      partner_ids: body.partner_ids,
    },
  })

  res.json({ result })
}
