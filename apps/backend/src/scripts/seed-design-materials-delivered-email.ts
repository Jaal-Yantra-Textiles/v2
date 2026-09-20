/**
 * Seed: the client-facing "your material has arrived" email (#2111).
 *
 * Sent by the `design-materials-delivered` subscriber when an inventory order
 * attached to a design reaches `Delivered`. It is the update a client actually
 * asks for between commissioning a piece and seeing it made — *is my fabric
 * here yet?* — and until now that fact lived in an inventory order nobody
 * outside the admin could see.
 *
 * Idempotent: creates the row only if `template_key` is not already present and
 * active. Data inlined as a const rather than a JSON import, so it survives the
 * prod `medusa build` with no asset-copy dependency.
 *
 * ⚠️ Until this has run the subscriber still fires and still finds the right
 * client — the template fetch is what fails, and the arrival mail simply does
 * not go. The subscriber logs it rather than throwing.
 *
 * Run — PREFER the maintenance job; it needs no shell and previews first:
 *   run_maintenance_job id=seed-email-templates set=design-materials-delivered
 *   (Settings → Data Plumbing, or the MCP tool. Preview writes nothing.)
 *
 * The exec path still works and stays for parity with the other seeds:
 *   npx medusa exec ./src/scripts/seed-design-materials-delivered-email.ts
 *   # prod: ./deploy/aws/scripts/run-backfill.sh seed-design-materials-delivered-email
 *
 * `designMaterialsDeliveredEmailTemplates` is the single source of truth for
 * both paths — the registry imports THIS const, so the two can never drift.
 */
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"

export const designMaterialsDeliveredEmailTemplates = [
  {
    template_key: "design-materials-delivered",
    name: "Customer — Design Materials Delivered",
    template_type: "customer",
    from: "designs@jaalyantra.com",
    is_active: true,
    locale: "en",
    subject: "The material for {{design_name}} has arrived",
    variables: {
      customer_name: "Client's display name",
      design_name: "The design the material was bought for",
      design_status: "The design's status at the time of the mail",
      design_url: "Link to the design, when it has a storefront handle",
      inventory_order_id: "The inventory order that was delivered",
      material_quantity: "Quantity on that order, in its own unit",
      current_year: "Year",
    },
    /*
     * 🔴 Deliberately says the cloth is WITH THE MAKER, not that the piece is
     * being made. Arrival releases the run to start; it is not the start. A
     * client told "we've begun" who then waits a fortnight for the production
     * mail has been misled by us, and the production-started template already
     * exists to say that when it is true.
     *
     * `material_quantity` carries no unit because the order does not store one
     * — 86 could be metres or pieces, so the sentence is written to read
     * correctly either way rather than inventing "m".
     */
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">The material for {{design_name}} has arrived</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Hi {{customer_name}}, the cloth we commissioned for <strong>{{design_name}}</strong> has been delivered and is now with the maker.</p><div style="background:#f4f4f5;padding:16px 18px;border-radius:10px;margin:16px 0"><p style="font-size:13px;line-height:1.7;color:#3f3f46;margin:0">This is the step your piece was waiting on. Work can now be scheduled, and we'll write again the moment it actually begins.</p></div><p style="font-size:14px;line-height:1.6;color:#3f3f46">Nothing is needed from you. If you'd like to see where things stand, just reply to this email.</p><p style="font-size:13px;margin:18px 0 0"><a href="{{design_url}}" style="color:#18181b">View your design</a></p><p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
]

export default async function seedDesignMaterialsDeliveredEmail({
  container,
}: {
  container: any
}) {
  const logger = container.resolve("logger")
  const svc: any = container.resolve(EMAIL_TEMPLATES_MODULE)

  let created = 0
  let skipped = 0
  for (const t of designMaterialsDeliveredEmailTemplates) {
    const locale = (t as any).locale ?? "en"
    const [existing] = await svc.listAndCountEmailTemplates({
      template_key: t.template_key,
      locale: locale as any,
      is_active: true,
    })
    if (existing && existing.length > 0) {
      skipped++
      logger.info(
        `[seed-design-materials-delivered-email] ⏭ ${t.template_key} (${locale}) exists — skip`
      )
      continue
    }
    await svc.createEmailTemplates([t])
    created++
    logger.info(
      `[seed-design-materials-delivered-email] ✅ created ${t.template_key} (${locale})`
    )
  }
  logger.info(
    `[seed-design-materials-delivered-email] done — created=${created} skipped=${skipped}`
  )
}
