import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { getSearchConsoleAnalyticsWorkflow } from "../../../../../../workflows/analytics/reports/get-search-console-analytics"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const { days, from, to } = req.query as Record<string, string>

  const parsedDays = days ? parseInt(days, 10) : undefined

  const { result } = await getSearchConsoleAnalyticsWorkflow(req.scope).run({
    input: {
      website_id: id,
      days: !Number.isNaN(parsedDays as number) ? parsedDays : undefined,
      from: from || undefined,
      to: to || undefined,
    },
  })

  res.json(result)
}
