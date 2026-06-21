import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { Modules } from "@medusajs/framework/utils";
import type { INotificationModuleService } from "@medusajs/types";
import * as Handlebars from "handlebars";
import { PARTNER_MODULE } from "../../modules/partner";
import PartnerService from "../../modules/partner/service";
import { EMAIL_TEMPLATES_MODULE } from "../../modules/email_templates";
import EmailTemplatesService from "../../modules/email_templates/service";
import type { PartnerStorefrontDigest } from "./partner-digest-lib";
import {
  buildPartnerDigestTemplateData,
  derivePartnerDigestFromEmail,
} from "./partner-digest-email-lib";

const TEMPLATE_KEY = "partner-storefront-digest";

export type SendPartnerDigestEmailInput = {
  /** Pre-computed digest (from `get-partner-storefront-digest`). */
  digest: PartnerStorefrontDigest;
  /** Optional override; defaults to `digest.partner_id`. */
  partner_id?: string;
};

// ---------------------------------------------------------------------------
// Step: resolve partner + active admins, compile the DB template and send a
// "storefront analytics digest" email to each active partner admin.
//
// Mirrors sendPartnerTaskAssignedStep (send-partner-task-assigned-email.ts):
//   - email_partner channel (Maileroo) so partner mail routes like the rest
//   - DB template fetched/compiled via EmailTemplatesService + Handlebars
//   - per-admin send is best-effort; a missing partner/template skips quietly
//     so a weekly visual-flow run never crashes on one un-provisioned partner.
// ---------------------------------------------------------------------------
const sendPartnerDigestStep = createStep(
  { name: "send-partner-storefront-digest-notification", store: true },
  async (input: SendPartnerDigestEmailInput, { container }) => {
    const digest = input.digest;
    const partnerId = input.partner_id || digest?.partner_id;

    if (!partnerId || !digest) {
      return new StepResponse({ sent: 0, skipped: true });
    }

    // 1) Partner + active admins
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE);
    let partner: any = null;
    let admins: any[] = [];
    try {
      const partners = await partnerService.listPartners(
        { id: partnerId },
        { relations: ["admins"], select: ["id", "name", "handle"] }
      );
      partner = (partners as any[])?.[0] || null;
      admins = (partner?.admins || []).filter((a: any) => a.is_active);
    } catch (err) {
      console.warn(
        `[partner-digest-email] Failed to fetch partner ${partnerId}: ${
          (err as Error).message
        }`
      );
    }

    if (!partner || admins.length === 0) {
      console.log(
        `[partner-digest-email] No partner/admins for ${partnerId} — skipping`
      );
      return new StepResponse({ sent: 0, skipped: true });
    }

    // 2) DB template (best-effort: a missing/inactive row never crashes the
    //    weekly digest flow — it just skips that partner).
    const emailTemplatesService: EmailTemplatesService =
      container.resolve(EMAIL_TEMPLATES_MODULE);
    let template: any;
    try {
      template = await emailTemplatesService.getTemplateByKey(TEMPLATE_KEY);
    } catch (err) {
      console.warn(
        `[partner-digest-email] Template "${TEMPLATE_KEY}" missing/inactive: ${
          (err as Error).message
        }`
      );
      return new StepResponse({ sent: 0, skipped: true });
    }

    const compiledHtml = Handlebars.compile(template.html_content);
    const compiledSubject = Handlebars.compile(template.subject);

    const fromDomain =
      process.env.MAILEROO_FROM_DOMAIN || "partner.jaalyantra.com";
    const partnerFromEmail = derivePartnerDigestFromEmail(
      partner.handle,
      fromDomain
    );
    const partnerFromName = partner.name || "Jaal Yantra Textiles Partner";
    const dashboardUrl = process.env.PARTNER_DASHBOARD_URL
      ? `${process.env.PARTNER_DASHBOARD_URL}/analytics`
      : "";

    const notificationService = container.resolve(
      Modules.NOTIFICATION
    ) as INotificationModuleService;

    let sentCount = 0;
    for (const admin of admins) {
      const templateData = buildPartnerDigestTemplateData({
        partner,
        admin,
        digest,
        dashboardUrl,
        storeUrl: process.env.FRONTEND_URL || "",
      });

      const renderedHtml = compiledHtml(templateData);
      const renderedSubject = compiledSubject(templateData);

      try {
        await notificationService.createNotifications({
          to: admin.email,
          channel: "email_partner",
          template: TEMPLATE_KEY,
          data: {
            ...templateData,
            _template_subject: renderedSubject,
            _template_html_content: renderedHtml,
            _template_from: partnerFromEmail,
            _template_processed: true,
            _partner_from_email: partnerFromEmail,
            _partner_from_name: partnerFromName,
          },
        });
        sentCount++;
        console.log(
          `[partner-digest-email] Sent ${TEMPLATE_KEY} to ${admin.email} (partner: ${partner.name})`
        );
      } catch (err) {
        console.error(
          `[partner-digest-email] Failed to send to ${admin.email}: ${
            (err as Error).message
          }`
        );
      }
    }

    return new StepResponse({ sent: sentCount, skipped: false });
  }
);

export const sendPartnerDigestEmailWorkflow = createWorkflow(
  { name: "send-partner-digest-email", store: true },
  (input: SendPartnerDigestEmailInput) => {
    const result = sendPartnerDigestStep(input);
    return new WorkflowResponse(result);
  }
);
