/**
 * Seed: the customer-facing "we changed your courier" email.
 *
 * Sent by `cancelShipmentForFulfillment` when an admin voids a waybill — the
 * customer is the one person guaranteed to notice a tracking link going dead,
 * and finding that out by clicking it is the worst way to learn.
 *
 * Idempotent — creates the row only if `template_key` isn't already present
 * (active). Mirrors `seed-additional-email-templates.ts` exactly (data inlined
 * as a const, not a JSON import, so it survives the prod `medusa build` with no
 * asset-copy dependency).
 *
 * ⚠️ Until this has run, the cancel still works: the email send is best-effort
 * and a missing template is logged, not thrown. `customer_notified: false` in
 * the response is the signal that this seed is outstanding.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-courier-changed-email.ts
 *   # prod: ./deploy/aws/scripts/run-backfill.sh seed-courier-changed-email
 */
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"

export const courierChangedEmailTemplates = [
  {
    template_key: "order-courier-changed",
    name: "Customer — Courier Changed / Shipment Rebooked",
    template_type: "customer",
    from: "orders@jaalyantra.com",
    is_active: true,
    locale: "en",
    subject: "A quick update on your order {{order_display_id}}",
    variables: {
      customer_name: "Customer's display name",
      order_display_id: "Human-readable order number, e.g. #1042",
      order_id: "Internal order id",
      previous_carrier: "Carrier the cancelled waybill was booked with",
      current_year: "Year",
    },
    // No tracking link and no new AWB on purpose: at send time the replacement
    // shipment does not exist yet. Promising a link we cannot include is how a
    // reassuring email becomes a second complaint.
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">A quick update on {{order_display_id}}</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Hi {{customer_name}}, we hit a problem with the courier booked for your order, so we've cancelled that booking and are arranging your delivery with a different courier partner.</p><div style="background:#f4f4f5;padding:16px 18px;border-radius:10px;margin:16px 0"><p style="font-size:13px;line-height:1.7;color:#3f3f46;margin:0"><strong>Nothing is needed from you.</strong> Your order is safe with us and still on its way. Any tracking link we sent earlier will stop updating — we'll send you a fresh one as soon as the new courier has collected your parcel.</p></div><p style="font-size:14px;line-height:1.6;color:#3f3f46">We're sorry for the delay this may cause. If you'd like an update in the meantime, just reply to this email and we'll check where things stand.</p><p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
]

export default async function seedCourierChangedEmail({
  container,
}: {
  container: any
}) {
  const logger = container.resolve("logger")
  const svc: any = container.resolve(EMAIL_TEMPLATES_MODULE)

  let created = 0
  let skipped = 0
  for (const t of courierChangedEmailTemplates) {
    const locale = (t as any).locale ?? "en"
    const [existing] = await svc.listAndCountEmailTemplates({
      template_key: t.template_key,
      locale: locale as any,
      is_active: true,
    })
    if (existing && existing.length > 0) {
      skipped++
      logger.info(
        `[seed-courier-changed-email] ⏭ ${t.template_key} (${locale}) exists — skip`
      )
      continue
    }
    await svc.createEmailTemplates([t])
    created++
    logger.info(
      `[seed-courier-changed-email] ✅ created ${t.template_key} (${locale})`
    )
  }
  logger.info(
    `[seed-courier-changed-email] done — created=${created} skipped=${skipped}`
  )
}
