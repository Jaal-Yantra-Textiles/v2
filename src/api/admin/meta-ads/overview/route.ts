import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { fetchMetaAdsOverviewWorkflow } from "../../../../workflows/meta-ads/fetch-overview"
import type { FetchOverviewInput } from "../../../../workflows/meta-ads/fetch-overview"

const coerceBoolean = (val: unknown, def: boolean): boolean => {
  if (val === undefined || val === null) return def
  if (typeof val === "boolean") return val
  if (typeof val === "number") return val !== 0
  if (typeof val === "string") {
    const s = val.trim().toLowerCase()
    if (s === "true" || s === "1" || s === "yes" || s === "y") return true
    if (s === "false" || s === "0" || s === "no" || s === "n") return false
  }
  return def
}

const coerceNumber = (val: unknown, def: number): number => {
  if (val === undefined || val === null) return def
  if (typeof val === "number") return Number.isFinite(val) ? val : def
  if (typeof val === "string") {
    const n = Number(val)
    return Number.isFinite(n) ? n : def
  }
  return def
}

const coerceRefresh = (val: unknown): "auto" | "force" | "never" => {
  const s = String(val ?? "").trim().toLowerCase()
  if (s === "auto" || s === "force" || s === "never") return s as any
  return "auto"
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = (req.validatedQuery || req.query) as Record<string, any>

  const level = (query.level || "account") as "account" | "campaign" | "adset" | "ad"

  let objectId: string
  if (level === "account") {
    objectId = query.ad_account_id
  } else {
    if (!query.object_id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "object_id is required when level is not account")
    }
    objectId = query.object_id
  }

  const input: FetchOverviewInput = {
    platform_id: query.platform_id,
    ad_account_id: query.ad_account_id,
    level,
    objectId,
    date_preset: query.date_preset || "last_30d",
    time_increment: coerceNumber(query.time_increment, 1),
    include_audience: coerceBoolean(query.include_audience, true),
    include_content: coerceBoolean(query.include_content, true),
    persist: coerceBoolean(query.persist, false),
    refresh: coerceRefresh(query.refresh),
    max_age_minutes: coerceNumber(query.max_age_minutes, 60),
  }

  const { result } = await fetchMetaAdsOverviewWorkflow(req.scope).run({ input })
  res.json(result)
}
