import { Select, Text, Tooltip, toast } from "@medusajs/ui"
import { useMemo } from "react"
import {
  useWhatsAppSenders,
  useUpdateConversationSender,
  type WhatsAppSender,
} from "../../../hooks/api/messaging"

const UNPINNED_VALUE = "__auto__"

interface SenderPickerProps {
  conversationId: string
  currentPlatformId: string | null
  recipientPhone?: string | null
}

/**
 * Per-conversation WhatsApp sender picker. Lets an admin pin replies to a
 * specific WhatsApp Business number, or fall back to automatic routing
 * (country-code match → default platform).
 *
 * Rendered in the conversation header bar. Keeps quiet (null) when only
 * one sender is configured — nothing to pick between.
 */
export const SenderPicker = ({
  conversationId,
  currentPlatformId,
  recipientPhone,
}: SenderPickerProps) => {
  const { senders = [], isPending } = useWhatsAppSenders()
  const update = useUpdateConversationSender(conversationId)

  const autoResolvedSender = useMemo(
    () => resolveAutoSender(senders, recipientPhone ?? null),
    [senders, recipientPhone]
  )

  // Single-number deployments don't need a picker. Skip rendering entirely
  // so we don't clutter the header bar.
  if (!isPending && senders.length <= 1) return null

  const value = currentPlatformId ?? UNPINNED_VALUE

  const handleChange = (next: string) => {
    const platformId = next === UNPINNED_VALUE ? null : next
    update.mutate(platformId, {
      onSuccess: () => {
        toast.success(
          platformId
            ? "Replies will go out from this WhatsApp number"
            : "Sender unpinned — using automatic routing"
        )
      },
      onError: (err: any) => {
        toast.error(err?.message || "Failed to change sender")
      },
    })
  }

  return (
    <div className="flex items-center gap-x-2">
      <Text size="xsmall" className="text-ui-fg-muted shrink-0">
        Sending as
      </Text>
      <Select value={value} onValueChange={handleChange} disabled={update.isPending}>
        <Select.Trigger className="w-[220px]">
          <Select.Value placeholder="Auto-route" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value={UNPINNED_VALUE}>
            <div className="flex flex-col gap-y-0.5">
              <span>Auto-route</span>
              <span className="text-ui-fg-muted text-xsmall">
                {autoResolvedSender
                  ? `Will use ${senderDisplayName(autoResolvedSender)}`
                  : "Default platform"}
              </span>
            </div>
          </Select.Item>
          {senders.map((s) => (
            <Select.Item key={s.platform_id} value={s.platform_id}>
              <div className="flex flex-col gap-y-0.5">
                <span>{senderDisplayName(s)}</span>
                <span className="text-ui-fg-muted text-xsmall">
                  {[
                    s.display_phone_number,
                    s.country_codes.length ? s.country_codes.join(", ") : null,
                    s.is_default ? "Default" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </Select.Item>
          ))}
        </Select.Content>
      </Select>
      {update.isPending && (
        <Tooltip content="Saving sender preference">
          <span className="inline-block w-2 h-2 rounded-full bg-ui-fg-interactive animate-pulse" />
        </Tooltip>
      )}
    </div>
  )
}

function senderDisplayName(s: WhatsAppSender): string {
  return (
    s.label ||
    s.verified_name ||
    s.display_phone_number ||
    s.name ||
    s.phone_number_id
  )
}

/**
 * Mirror the backend's routing rules for the "Auto-route" description so
 * the admin can see which number will be used before committing.
 * Precedence: longest country-code prefix match → is_default → first.
 */
function resolveAutoSender(
  senders: WhatsAppSender[],
  recipient: string | null
): WhatsAppSender | null {
  if (senders.length === 0) return null
  if (recipient) {
    const normalized = recipient.startsWith("+") ? recipient : `+${recipient}`
    let best: { sender: WhatsAppSender; matchLen: number } | null = null
    for (const s of senders) {
      for (const code of s.country_codes || []) {
        const norm = code.startsWith("+") ? code : `+${code}`
        if (normalized.startsWith(norm) && (!best || norm.length > best.matchLen)) {
          best = { sender: s, matchLen: norm.length }
        }
      }
    }
    if (best) return best.sender
  }
  return senders.find((s) => s.is_default) ?? senders[0]
}
