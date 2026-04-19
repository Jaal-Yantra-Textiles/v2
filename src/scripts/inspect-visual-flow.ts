import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import { SOCIALS_MODULE } from "../modules/socials"
import type SocialsService from "../modules/socials/service"

/**
 * Diagnostic: dump a visual flow's operations + latest execution logs.
 *
 * Run:
 *   FLOW_ID=vflow_01KPG0PYBWPH66K0P1SWFNYJ9X npx medusa exec ./src/scripts/inspect-visual-flow.ts
 */
export default async function inspectVisualFlow({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const flowId = process.env.FLOW_ID
  if (!flowId) {
    logger.error("Set FLOW_ID=vflow_... before running.")
    return
  }

  const service = container.resolve(VISUAL_FLOWS_MODULE) as any
  const socials = container.resolve(SOCIALS_MODULE) as unknown as SocialsService

  // Flow + operations
  const flow = await service.retrieveVisualFlow(flowId, { relations: ["operations"] })
  logger.info(`\nFlow: ${flow.name} (${flow.id}) — status=${flow.status}`)
  logger.info(`Trigger: ${flow.trigger_type} ${JSON.stringify(flow.trigger_config)}\n`)

  for (const op of flow.operations || []) {
    logger.info(`─ op: ${op.operation_key} [${op.operation_type}]`)
    logger.info(`  options: ${JSON.stringify(op.options, null, 2)}`)
  }

  // Resolve which platform would send for a recipient
  const send = (flow.operations || []).find((o: any) => o.operation_type === "send_whatsapp")
  if (send) {
    const to = send.options?.to
    const explicit = send.options?.platform_id
    logger.info(`\nResolution for send_whatsapp node:`)
    logger.info(`  to: ${to || "(empty — filled via interpolation at runtime)"}`)
    logger.info(`  explicit platform_id: ${explicit || "(none — auto-route)"}`)
    if (!explicit && to && !to.includes("{{")) {
      const p = await socials.findWhatsAppPlatformForRecipient(to)
      if (p) {
        const cfg = (p.api_config ?? {}) as any
        logger.info(`  resolved platform: ${p.id}`)
        logger.info(`    label:           ${cfg.label ?? "(none)"}`)
        logger.info(`    phone_number_id: ${cfg.phone_number_id}`)
        logger.info(`    waba_id:         ${cfg.waba_id}`)
        logger.info(`    country_codes:   ${JSON.stringify(cfg.country_codes ?? [])}`)
        logger.info(`    is_default:      ${cfg.is_default === true}`)
      } else {
        logger.warn(`  resolved platform: NONE (will fall back to env-var default)`)
      }
    }
  }

  // Latest executions + logs
  const [execs] = await service.listAndCountVisualFlowExecutions(
    { flow_id: flowId },
    { take: 3, order: { created_at: "DESC" } }
  )
  logger.info(`\nRecent executions:`)
  for (const e of execs || []) {
    logger.info(`  ${e.id} — ${e.status} @ ${e.created_at}`)
  }

  if (execs?.[0]) {
    const latestId = execs[0].id
    const [logs] = await service.listAndCountVisualFlowExecutionLogs(
      { execution_id: latestId },
      { take: 50, order: { created_at: "ASC" } }
    )
    logger.info(`\nLogs for latest execution ${latestId}:`)
    for (const l of logs || []) {
      logger.info(`  [${l.status}] ${l.operation_key ?? "(flow)"} — ${l.message ?? ""}`)
      if (l.input) logger.info(`    input:  ${short(JSON.stringify(l.input))}`)
      if (l.output) logger.info(`    output: ${short(JSON.stringify(l.output))}`)
      if (l.error) logger.info(`    error:  ${l.error}`)
    }
  }
}

function short(s: string): string {
  return s.length > 500 ? s.slice(0, 500) + "…" : s
}
