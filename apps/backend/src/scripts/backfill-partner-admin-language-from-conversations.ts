/**
 * Backfill: copy conversation.metadata.language onto partner_admin.preferred_language
 *
 * Why
 *   Until #fix/whatsapp-language-persist, the WhatsApp onboarding flow
 *   stored a partner's tapped language choice ("हिंदी" / "English") only
 *   in messaging_conversation.metadata.language. Outbound visual flows
 *   (assignment, payment-status, reminders) read
 *   partner.admins[*].preferred_language to pick the template language,
 *   so every Hindi-selected partner kept getting English templates.
 *
 *   New onboarding writes both sides going forward. This script
 *   retro-fixes partners who already onboarded.
 *
 * Strategy
 *   1. List every messaging_conversation with metadata.language set
 *   2. Resolve the partner + their admins
 *   3. Match admin by phone vs conversation.phone_number first
 *   4. If no phone match, apply to every admin on that partner
 *   5. Skip admins whose preferred_language already matches (idempotent)
 *
 * Run locally
 *   npx medusa exec ./src/scripts/backfill-partner-admin-language-from-conversations.ts
 *
 * Run on AWS Fargate
 *   ./deploy/aws/scripts/run-backfill.sh backfill-partner-admin-language-from-conversations
 *
 * Dry run
 *   DRY_RUN=1 npx medusa exec ./src/scripts/backfill-partner-admin-language-from-conversations.ts
 */

import { MESSAGING_MODULE } from "../modules/messaging"
import { PARTNER_MODULE } from "../modules/partner"

export default async function backfillPartnerAdminLanguage({
  container,
}: {
  container: any
}) {
  const messagingService = container.resolve(MESSAGING_MODULE) as any
  const partnerService = container.resolve(PARTNER_MODULE) as any
  const dryRun = process.env.DRY_RUN === "1"

  console.log(`[backfill] dry_run=${dryRun}`)

  // 1. Pull every active conversation. The DAL doesn't filter by JSON
  //    metadata keys directly, so we pull and filter in JS. We page in
  //    batches of 100 to keep memory bounded.
  const PAGE = 100
  let offset = 0
  let scanned = 0
  let updated = 0
  let skippedAlreadyMatched = 0
  let skippedNoLang = 0
  let skippedNoPartner = 0

  while (true) {
    const [convs] = await messagingService.listAndCountMessagingConversations(
      {},
      { take: PAGE, skip: offset, order: { created_at: "DESC" } }
    )
    if (!convs?.length) break
    scanned += convs.length

    for (const conv of convs) {
      const lang = (conv?.metadata as any)?.language
      if (lang !== "hi" && lang !== "en") {
        skippedNoLang++
        continue
      }

      const partnerId = conv.partner_id
      if (!partnerId) {
        skippedNoPartner++
        continue
      }

      const [partners] = await partnerService.listAndCountPartners(
        { id: partnerId },
        { take: 1, relations: ["admins"] }
      )
      const partner = partners?.[0]
      if (!partner) {
        skippedNoPartner++
        continue
      }

      const phone = String(conv.phone_number || "").replace(/[^0-9]/g, "")
      const admins = Array.isArray(partner.admins) ? partner.admins : []

      const matched = admins.find((a: any) => {
        if (!a?.phone) return false
        const norm = String(a.phone).replace(/[^0-9]/g, "")
        return !!norm && (norm === phone || norm.endsWith(phone) || phone.endsWith(norm))
      })

      const targets = (matched ? [matched] : admins).filter(
        (a: any) => a?.id && a.preferred_language !== lang
      )
      if (!targets.length) {
        skippedAlreadyMatched++
        continue
      }

      console.log(
        `[backfill] partner=${partnerId} lang=${lang} phone=${phone} ` +
          `admins=${targets.map((a: any) => a.id).join(",")} ` +
          `${matched ? "(phone-matched)" : "(all admins fallback)"}`
      )

      if (!dryRun) {
        await Promise.all(
          targets.map((a: any) =>
            partnerService.updatePartnerAdmins({ id: a.id, preferred_language: lang })
          )
        )
      }
      updated += targets.length
    }

    if (convs.length < PAGE) break
    offset += PAGE
  }

  console.log(`[backfill] done`, {
    dry_run: dryRun,
    scanned_conversations: scanned,
    admins_updated: updated,
    skipped_already_matched: skippedAlreadyMatched,
    skipped_no_language: skippedNoLang,
    skipped_no_partner: skippedNoPartner,
  })
}
