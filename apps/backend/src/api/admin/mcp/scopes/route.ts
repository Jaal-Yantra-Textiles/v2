/**
 * GET/POST /admin/mcp/scopes — manage per-credential MCP scopes (#1306 Track C).
 *
 * A scope row narrows ONE credential below the process ceiling
 * (`ADMIN_MCP_ENABLE_WRITE` / `ADMIN_MCP_ENABLE_DANGEROUS`). Absent a row the
 * credential gets the ceiling, which is the behaviour that existed before.
 *
 * ⚠️ HUMAN ADMINS ONLY. Both handlers refuse any principal that is not
 * `actor_type: "user"`. A machine credential must never be able to widen its own
 * scope — without this check a token scoped to `write` could POST itself up to
 * `dangerous`, and the whole mechanism would be decorative.
 *
 * Deliberately NOT wrapped as MCP tools for the same reason: the tool surface is
 * driven by a model, and scope escalation is not a thing a model should be able
 * to attempt on its own.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MCP_ACCESS_MODULE } from "../../../../modules/mcp_access"
import type McpAccessService from "../../../../modules/mcp_access/service"
import {
  MCP_SCOPE_LEVELS,
  isMcpScopeLevel,
  mcpPrincipalFromRequest,
  minMcpScope,
  type McpScopeLevel,
} from "../../../../lib/mcp-scope"
import { adminMcpCeiling, adminToolCountsByLevel } from "../lib/handler"

/** Refuse anything that is not a logged-in human admin. Returns true if handled. */
const refuseNonHumanAdmin = (
  req: MedusaRequest,
  res: MedusaResponse
): boolean => {
  const principal = mcpPrincipalFromRequest(req)
  if (principal && principal.type === "user") {
    return false
  }
  res.status(403).json({
    message:
      "MCP scopes can only be managed by a signed-in admin user. A machine " +
      "credential cannot read or change its own scope.",
  })
  return true
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  if (refuseNonHumanAdmin(req, res)) return

  const service = req.scope.resolve(MCP_ACCESS_MODULE) as McpAccessService
  const scopes = await service.listMcpAccessScopes({})

  const counts = adminToolCountsByLevel()

  res.json({
    scopes: (scopes as any[]).map((s) => ({
      id: s.id,
      principal_type: s.principal_type,
      principal_id: s.principal_id,
      level: s.level,
      label: s.label,
      note: s.note,
      created_at: s.created_at,
      updated_at: s.updated_at,
    })),
    // The ceiling is the process-wide cap; a row can only ever restrict below
    // it, so a level above `ceiling` is stored but has no effect.
    ceiling: adminMcpCeiling(),
    // Tools each level exposes. The rungs are genuinely distinct since #1310
    // split the tier axis out of the `sensitive` flag — `write` no longer
    // equals `read`, so picking it is a real choice.
    levels: MCP_SCOPE_LEVELS.map((level) => ({
      level,
      tools: counts[level],
    })),
  })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  if (refuseNonHumanAdmin(req, res)) return

  const body = ((req as any).validatedBody || req.body || {}) as {
    principal_type?: string
    principal_id?: string
    level?: string
    label?: string | null
    note?: string | null
  }

  const principalType = String(body.principal_type || "").trim()
  const principalId = String(body.principal_id || "").trim()
  const level = String(body.level || "").trim()

  if (!principalType || !principalId) {
    return res.status(400).json({
      message:
        "principal_type and principal_id are required. For a Medusa secret API key, principal_type is 'api-key' and principal_id is the key id (apk_…).",
    })
  }
  if (!isMcpScopeLevel(level)) {
    return res.status(400).json({
      message: `level must be one of: ${MCP_SCOPE_LEVELS.join(", ")}`,
    })
  }

  const service = req.scope.resolve(MCP_ACCESS_MODULE) as McpAccessService
  const scope = await service.setScope({
    principal_type: principalType,
    principal_id: principalId,
    level: level as McpScopeLevel,
    label: body.label ?? null,
    note: body.note ?? null,
  })

  const counts = adminToolCountsByLevel()
  const ceiling = adminMcpCeiling()
  const effective = minMcpScope(ceiling, level as McpScopeLevel)

  res.json({
    scope,
    effective_level: effective,
    ceiling,
    // Counted at the EFFECTIVE level, not the requested one — a row granting
    // more than the ceiling is stored but clamped, and reporting the granted
    // level's count here would overstate what the credential can actually see.
    tools_visible: counts[effective],
    // Stated explicitly rather than left for the reader to infer from two
    // fields that happen to differ.
    ...(effective !== level
      ? {
          warning: `Stored as '${level}', but the process ceiling is '${ceiling}', so this credential operates at '${effective}'. Raising it requires ADMIN_MCP_ENABLE_WRITE / ADMIN_MCP_ENABLE_DANGEROUS.`,
        }
      : {}),
    // The whole ladder, so the operator can see what the neighbouring rungs
    // would have bought at the moment of choosing this one.
    tools_by_level: counts,
  })
}
