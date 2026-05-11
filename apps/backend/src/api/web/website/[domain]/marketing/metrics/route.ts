import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type RawPartner = {
  workspace_type: "seller" | "manufacturer" | "individual"
  vercel_linked: boolean
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "partners",
    fields: ["workspace_type", "vercel_linked"],
    filters: { status: "active" },
    pagination: { take: 1000 },
  })

  let artisans = 0
  let brandsLive = 0
  for (const p of (data || []) as unknown as RawPartner[]) {
    if (p.workspace_type === "individual" || p.workspace_type === "manufacturer") {
      artisans++
    } else if (p.workspace_type === "seller" && p.vercel_linked) {
      brandsLive++
    }
  }

  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  res.status(200).json({
    artisans,
    brands_live: brandsLive,
    // Distinct production hubs — derived once we wire partner-region links.
    hubs: 3,
    last_updated: new Date().toISOString(),
  })
}
