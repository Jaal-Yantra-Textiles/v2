import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MedusaError } from "@medusajs/framework/utils";

import { findWebsiteByDomainWorkflow } from "../../../../../workflows/website/find-website-by-domain";
import {
  isValidEmail,
  maskEmail,
  resolveEmailById,
  resolveUnsubServices,
  suppressEmailEverywhere,
} from "./lib";

/**
 * Public unsubscribe endpoint — the missing counterpart to `subscribe`.
 *
 * GET  /web/website/:domain/unsubscribe?id=&email=
 *   Non-mutating. Resolves the target email (from `email`, else by `id`) and
 *   returns it MASKED so the storefront confirmation page can echo which address
 *   is about to be unsubscribed. A mutating link is deliberately NOT used on GET
 *   so email-scanner prefetches can't opt people out — the storefront requires
 *   an explicit confirm click that POSTs.
 *
 * POST /web/website/:domain/unsubscribe { id?, email? }
 *   Suppresses the address across person/customer/lead. Idempotent.
 */

function readParams(source: Record<string, any>): { id?: string; email?: string } {
  const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : undefined;
  const rawEmail =
    typeof source.email === "string" && source.email.trim()
      ? source.email.trim().toLowerCase()
      : undefined;
  const email = rawEmail && isValidEmail(rawEmail) ? rawEmail : undefined;
  return { id, email };
}

async function assertWebsite(req: MedusaRequest) {
  const { domain } = req.params;
  const websiteResponse = await findWebsiteByDomainWorkflow(req.scope).run({
    input: { domain },
  });
  if (websiteResponse.errors.length > 0) {
    throw websiteResponse.errors;
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  await assertWebsite(req);
  const { id, email } = readParams(req.query as Record<string, any>);

  if (!id && !email) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "An id or email is required to identify the subscription"
    );
  }

  const services = resolveUnsubServices(req.scope);
  const target = email || (id ? await resolveEmailById(services, id) : null);

  if (!target) {
    // The link's id no longer resolves (record deleted, or bad link). Report
    // gracefully rather than 500 — the page shows a neutral "already removed".
    return res.status(200).json({ found: false, email: null });
  }

  return res.status(200).json({ found: true, email: maskEmail(target) });
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await assertWebsite(req);
  // Body is not schema-validated in middleware (both fields optional); read from
  // validatedBody when present, else the raw body.
  const body = (req as any).validatedBody ?? req.body ?? {};
  const { id, email } = readParams(body as Record<string, any>);

  if (!id && !email) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "An id or email is required to unsubscribe"
    );
  }

  const services = resolveUnsubServices(req.scope);
  const target = email || (id ? await resolveEmailById(services, id) : null);

  if (!target) {
    // Nothing to unsubscribe — treat as success (the recipient's goal is met).
    return res.status(200).json({
      message: "You're not on our mailing list.",
      email: null,
      unsubscribed: 0,
    });
  }

  const at = new Date().toISOString();
  const result = await suppressEmailEverywhere(services, target, at);

  return res.status(200).json({
    message: result.alreadyOff
      ? "You're already unsubscribed."
      : "You've been unsubscribed. You won't receive these emails anymore.",
    email: maskEmail(target),
    unsubscribed: result.suppressed,
    already_off: result.alreadyOff,
  });
};
