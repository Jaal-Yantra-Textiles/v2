/**
 * GET /admin/marketing/newsletter-prefill — return the latest AI-generated
 * newsletter draft (the #687 `generate-marketing-newsletter-draft` job persists
 * these as `marketing_draft` rows, kind="newsletter") mapped to the blog
 * editor's `{ title, content }` so the operator can create a `page_type=
 * "Newsletter"` page pre-filled with the AI copy, then edit + send it.
 *
 * No middleware: a simple read. Empty when no newsletter draft exists yet
 * (→ 200 with draft:null), so the editor just opens blank.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MARKETING_MODULE } from "../../../../modules/marketing"
import { buildNewsletterPrefill } from "../newsletter-prefill-lib"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const marketingService: any = req.scope.resolve(MARKETING_MODULE)

  const [draft] = await marketingService.listMarketingDrafts(
    { kind: "newsletter" },
    { order: { created_at: "DESC" }, take: 1 }
  )

  if (!draft) {
    res.json({ draft: null, title: "", content: "" })
    return
  }

  const prefill = buildNewsletterPrefill(draft.payload)
  res.json({
    draft: { id: draft.id, name: draft.name, created_at: draft.created_at },
    ...prefill,
  })
}
