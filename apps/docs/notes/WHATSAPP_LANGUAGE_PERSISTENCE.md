# WhatsApp Language Preference — Dual Write + Backfill

> Status: **SHIPPED** 2026-06-01.
> Companion: implementation lives in
> `apps/backend/src/workflows/whatsapp/whatsapp-message-handler.ts`
> (handler write) + `apps/backend/src/scripts/backfill-partner-admin-language-from-conversations.ts`
> (one-off retro fix).

## The bug

Partner taps "हिंदी" / "English" on the onboarding language prompt over WhatsApp. The choice was being written **only** to `messaging_conversation.metadata.language`. The handler itself read from there and worked fine — replies sent inside `handleIncomingMessage` came out in the right language.

But every **outbound visual flow** (production-run assignment, payment-status updates, daily reminders) resolves the template language by reading `partner.admins[*].preferred_language`. That column stayed `NULL` because nothing ever wrote to it. So:

- Sharlho (partner `01K4PJMNMNRGMK0ZXMKBBDZDGD`) tapped Hindi months ago
- Every subsequent template (assignment, paid, reminder) landed in English
- No error in any log — the send went through cleanly, just in the wrong language

Discovered when an operator noticed Hindi-confirmed partners still getting English production-run templates. Took a while to find because `conversation.metadata.language` was correctly `"hi"` the whole time — the bug was the missing second write, not the captured preference.

## Fix

Two parts.

### 1. Dual write at selection time

`handleIncomingMessage` already had a branch for `lang_hi` / `lang_en` button taps that wrote `conversation.metadata.language`. Add a call to `persistPartnerAdminLanguage(scope, partnerId, fromPhone, lang)` right after, which:

1. Loads the partner with its admins
2. Tries to match an admin by phone (admin.phone vs message.from, normalized)
3. If no phone match (common — admins often don't have phone on file), applies to **all admins** on the partner so we don't silently miss
4. Calls `partnerService.updatePartnerAdmins({ id, preferred_language: lang })` for each match
5. Skips admins whose `preferred_language` already equals `lang` (idempotent)

Failures are non-fatal and logged. The conversation.metadata write already gave correct handler-side behaviour; this is purely a hardening pass on the outbound side.

### 2. Backfill script for already-onboarded partners

Code fix only helps partners who go through onboarding *after* deploy. Sharlho and any other historical Hindi/English tappers still had `NULL` admin rows.

`backfill-partner-admin-language-from-conversations.ts` walks every conversation row, applies the same dual-write logic (phone match → fallback to all admins), and skips rows where the language was never set or the admin already has it.

Idempotent. Re-runnable. Honors `DRY_RUN=1`.

### Run on AWS Fargate

```bash
# Scope first
DRY_RUN=1 ./deploy/aws/scripts/run-backfill.sh backfill-partner-admin-language-from-conversations

# Apply
./deploy/aws/scripts/run-backfill.sh backfill-partner-admin-language-from-conversations
```

## Backfill results — 2026-06-01

| Metric | Count |
|---|---|
| Conversations scanned | 9 |
| Admins updated | **3** |
| Skipped — already correct | 3 |
| Skipped — no language saved | 4 |
| Skipped — no partner | 0 |

Updated:

- Partner `01K4PJMNMNRGMK0ZXMKBBDZDGD` (Sharlho) — 2 admins → `hi` *(the original report)*
- Partner `01KNY6B5ERNDXJ5118EK72KFTV` — 1 admin → `en`

Both used the "all admins fallback" path (no admin row had a phone matching the conversation phone).

## Why the phone-matching fallback is broad

Most partner admins don't have `phone` set today — onboarding only collects `email` + `first_name` + `last_name`. Until that changes, "match by phone, else apply to every admin on this partner" is the safer default. The downside is multi-admin partners where two humans share one phone get the same language — fine for the current cohort, worth revisiting if a partner adds a second admin with a different language preference.

## Open follow-ups

- Stop showing the language prompt to partners who already have `preferred_language` set on at least one admin (today they get re-prompted on every fresh conversation). Cheap win.
- Add a `Settings → Language` button to the partner-ui so partners can change later without re-onboarding. Currently the only path is a fresh language-tap on the prompt.
- Surface the current language on the partner detail page in admin so operators can verify without inspecting JSON.
