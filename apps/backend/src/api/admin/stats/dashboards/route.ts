import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { STATS_MODULE } from "../../../../modules/stats"
import StatsService from "../../../../modules/stats/service"
import { createDashboardSchema, listDashboardsQuerySchema } from "../validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const service: StatsService = req.scope.resolve(STATS_MODULE)
    const query = listDashboardsQuerySchema.parse(req.query)

    const filters: Record<string, any> = {}
    if (query.q) {
      filters.name = { $ilike: `%${query.q}%` }
    }

    const [dashboards, count] = await service.listAndCountStatsDashboards(
      filters,
      {
        take: query.limit,
        skip: query.offset,
        order: { created_at: "DESC" },
      }
    )

    res.json({
      dashboards,
      count,
      limit: query.limit,
      offset: query.offset,
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: error.issues })
      return
    }
    res.status(400).json({ error: error.message })
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const service: StatsService = req.scope.resolve(STATS_MODULE)
    const data = createDashboardSchema.parse(req.body)

    const dashboard = await service.createStatsDashboards(data)

    res.status(201).json({ dashboard })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: error.issues })
      return
    }
    res.status(400).json({ error: error.message })
  }
}
