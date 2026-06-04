/**
 * Seed (or refresh) the two email templates used by the visual-flow
 * lifecycle subscriber:
 *
 *   - `visual-flow-started`  → light "flow X started" ack
 *   - `visual-flow-failure`  → full error report when a flow execution
 *                              lands as failed
 *
 * Re-runnable. Admins can edit the body / subject in the admin UI
 * without re-deploying because the subscriber renders by template_key.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-visual-flow-lifecycle-email-templates.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"

type TemplateSpec = {
  template_key: string
  name: string
  description: string
  subject: string
  html_content: string
  variables: Record<string, string>
}

const STARTED: TemplateSpec = {
  template_key: "visual-flow-started",
  name: "Visual flow — execution started",
  description:
    "Sent to the configured admin recipient when a visual flow begins executing. Lets admins notice flows that started but never landed as completed.",
  subject: "[Flow started] {{flow_name}}",
  html_content: `<!doctype html>
<html><head><meta charset="utf-8"><title>{{flow_name}}</title></head>
<body style="margin:0;padding:0;background:#f7f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#2a2620;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f5f0;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e0d3;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;">
          <p style="margin:0;font-style:italic;color:#5a7a3f;font-size:14px;">Started</p>
          <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;color:#2a2620;">{{flow_name}}</h1>
          <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#5a534a;">Execution kicked off at {{started_at}}.</p>
        </td></tr>
        <tr><td style="padding:0 32px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;color:#5a534a;">
            <tr><td style="padding:6px 0;width:140px;color:#9a8e7c;">Execution ID</td>
                <td style="padding:6px 0;font-family:ui-monospace,monospace;color:#2a2620;">{{execution_id}}</td></tr>
            {{#if triggered_by_event}}
            <tr><td style="padding:6px 0;color:#9a8e7c;">Triggered by event</td>
                <td style="padding:6px 0;font-family:ui-monospace,monospace;color:#2a2620;">{{triggered_by_event}}</td></tr>
            {{/if}}
            {{#if triggered_by}}
            <tr><td style="padding:6px 0;color:#9a8e7c;">Triggered by</td>
                <td style="padding:6px 0;font-family:ui-monospace,monospace;color:#2a2620;">{{triggered_by}}</td></tr>
            {{/if}}
          </table>
        </td></tr>
        {{#if execution_url}}
        <tr><td style="padding:0 32px 32px;">
          <a href="{{execution_url}}" style="display:inline-block;background:#2a2620;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px;padding:10px 18px;border-radius:999px;">Open execution</a>
        </td></tr>
        {{/if}}
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#9a8e7c;font-style:italic;">JYT visual flows · lifecycle notification.</p>
    </td></tr>
  </table>
</body></html>`,
  variables: {
    flow_name: "string",
    execution_id: "string",
    triggered_by_event: "string",
    triggered_by: "string",
    started_at: "ISO date",
    execution_url: "string",
  },
}

const FAILURE: TemplateSpec = {
  template_key: "visual-flow-failure",
  name: "Visual flow — execution failed",
  description:
    "Sent to the configured admin recipient when a visual flow execution lands as failed. Includes failing operation key + error message so admins can diagnose without trawling logs.",
  subject: "[Flow failed] {{flow_name}} — {{failing_operation_key}}",
  html_content: `<!doctype html>
<html><head><meta charset="utf-8"><title>{{flow_name}} failed</title></head>
<body style="margin:0;padding:0;background:#f7f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#2a2620;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f5f0;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e0d3;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;">
          <p style="margin:0;font-style:italic;color:#9a3f3f;font-size:14px;">Failed</p>
          <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;color:#2a2620;">{{flow_name}}</h1>
          <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#5a534a;">Execution failed at {{failed_at}}.</p>
        </td></tr>

        <tr><td style="padding:24px 32px 8px;">
          <h2 style="margin:0;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#9a8e7c;">Failure</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;color:#5a534a;margin-top:8px;">
            {{#if failing_operation_key}}
            <tr><td style="padding:6px 0;width:140px;color:#9a8e7c;">Operation</td>
                <td style="padding:6px 0;font-family:ui-monospace,monospace;color:#2a2620;">{{failing_operation_key}}</td></tr>
            {{/if}}
            <tr><td style="padding:6px 0;color:#9a8e7c;vertical-align:top;">Error</td>
                <td style="padding:6px 0;font-family:ui-monospace,monospace;color:#9a3f3f;word-break:break-word;">{{error_message}}</td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:16px 32px 8px;">
          <h2 style="margin:0;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#9a8e7c;">Context</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;color:#5a534a;margin-top:8px;">
            <tr><td style="padding:6px 0;width:140px;color:#9a8e7c;">Execution ID</td>
                <td style="padding:6px 0;font-family:ui-monospace,monospace;color:#2a2620;">{{execution_id}}</td></tr>
            {{#if triggered_by_event}}
            <tr><td style="padding:6px 0;color:#9a8e7c;">Triggered by event</td>
                <td style="padding:6px 0;font-family:ui-monospace,monospace;color:#2a2620;">{{triggered_by_event}}</td></tr>
            {{/if}}
            {{#if triggered_by}}
            <tr><td style="padding:6px 0;color:#9a8e7c;">Triggered by</td>
                <td style="padding:6px 0;font-family:ui-monospace,monospace;color:#2a2620;">{{triggered_by}}</td></tr>
            {{/if}}
          </table>
        </td></tr>

        {{#if execution_url}}
        <tr><td style="padding:16px 32px 32px;">
          <a href="{{execution_url}}" style="display:inline-block;background:#9a3f3f;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px;padding:10px 18px;border-radius:999px;">Open execution</a>
          <p style="margin:12px 0 0;font-size:12px;color:#9a8e7c;">Repeat failures with the same fingerprint are throttled per flow.</p>
        </td></tr>
        {{/if}}
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#9a8e7c;font-style:italic;">JYT visual flows · lifecycle notification.</p>
    </td></tr>
  </table>
</body></html>`,
  variables: {
    flow_name: "string",
    execution_id: "string",
    failing_operation_key: "string",
    error_message: "string",
    triggered_by_event: "string",
    triggered_by: "string",
    failed_at: "ISO date",
    execution_url: "string",
  },
}

async function upsert(templates: any, spec: TemplateSpec, logger: any) {
  const [existing] = await templates.listAndCountEmailTemplates(
    { template_key: spec.template_key },
    { take: 1 }
  )
  const current = existing?.[0]

  const fields = {
    name: spec.name,
    description: spec.description,
    template_key: spec.template_key,
    subject: spec.subject,
    html_content: spec.html_content,
    is_active: true,
    template_type: "transactional",
    variables: spec.variables,
  }

  if (current) {
    await templates.updateEmailTemplates({ id: current.id, ...fields })
    logger.info(`Updated email template ${current.id} (${spec.template_key})`)
  } else {
    const created = await templates.createEmailTemplates(fields)
    logger.info(`Created email template ${created.id} (${spec.template_key})`)
  }
}

export default async function seedVisualFlowLifecycleEmailTemplates({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const templates: any = container.resolve(EMAIL_TEMPLATES_MODULE)

  await upsert(templates, STARTED, logger)
  await upsert(templates, FAILURE, logger)
}
