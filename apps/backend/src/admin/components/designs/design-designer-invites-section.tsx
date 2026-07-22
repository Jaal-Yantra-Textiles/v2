import { useState } from "react"
import { Badge, Button, Container, Heading, Input, Text, toast, usePrompt } from "@medusajs/ui"
import { Plus, Trash } from "@medusajs/icons"

import {
  AdminDesign,
  DesignerInvite,
  useCreateDesignerInvite,
  useDesignerInvites,
  useRevokeDesignerInvite,
} from "../../hooks/api/designs"

interface Props {
  design: AdminDesign
}

const STATUS_COLOR: Record<string, "green" | "orange" | "red" | "grey"> = {
  accepted: "green",
  pending: "orange",
  revoked: "red",
}

const relative = (iso: string | null) => {
  if (!iso) {
    return "no expiry"
  }
  const d = new Date(iso).getTime() - Date.now()
  if (d <= 0) {
    return "expired"
  }
  const days = Math.round(d / (24 * 60 * 60 * 1000))
  return days >= 1 ? `${days}d left` : "<1d left"
}

/**
 * #1113 S4 — mint/list/revoke scoped designer invites for a single design.
 * With an email, the invite is sent to the recipient; without one, a shareable
 * link is minted and copied to the clipboard (the raw link is only returned once
 * at creation, so we surface it immediately).
 */
export const DesignDesignerInvitesSection = ({ design }: Props) => {
  const { invites, isPending } = useDesignerInvites(design.id)
  const { mutateAsync: createInvite, isPending: isCreating } = useCreateDesignerInvite(design.id)
  const { mutateAsync: revokeInvite } = useRevokeDesignerInvite(design.id)
  const prompt = usePrompt()

  const [email, setEmail] = useState("")
  const [expiresDays, setExpiresDays] = useState("")
  const [lastUrl, setLastUrl] = useState<string | null>(null)

  const copy = (url: string) => {
    navigator.clipboard.writeText(url)
    toast.success("Invite link copied")
  }

  const handleCreate = async () => {
    const trimmed = email.trim()
    const days = expiresDays.trim() ? parseInt(expiresDays.trim(), 10) : undefined
    if (days != null && (!Number.isFinite(days) || days <= 0)) {
      toast.error("Expiry must be a positive number of days")
      return
    }
    try {
      const res = await createInvite({
        email: trimmed || undefined,
        expires_in_days: days,
        inviter_name: (design as any)?.name ? `${(design as any).name} team` : undefined,
      })
      setLastUrl(res.url)
      setEmail("")
      setExpiresDays("")
      if (res.emailed) {
        toast.success(`Invite emailed to ${trimmed}`)
      } else {
        copy(res.url)
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to create invite")
    }
  }

  const handleRevoke = async (invite: DesignerInvite) => {
    const ok = await prompt({
      title: "Revoke invite",
      description: `Revoke the invite${invite.email ? ` for ${invite.email}` : ""}? The link will stop working.`,
      confirmText: "Revoke",
      cancelText: "Keep",
    })
    if (!ok) {
      return
    }
    try {
      await revokeInvite(invite.id)
      toast.success("Invite revoked")
    } catch (e: any) {
      toast.error(e?.message || "Failed to revoke invite")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Designer invites</Heading>
          <Badge size="2xsmall" color="grey" rounded="full">
            {invites.length}
          </Badge>
        </div>
      </div>

      {/* Mint form */}
      <div className="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center">
        <Input
          type="email"
          placeholder="Email (optional — sends an invite)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1"
        />
        <Input
          type="number"
          min={1}
          placeholder="Expires (days)"
          value={expiresDays}
          onChange={(e) => setExpiresDays(e.target.value)}
          className="sm:w-40"
        />
        <Button variant="secondary" size="small" onClick={handleCreate} isLoading={isCreating}>
          <Plus className="mr-1" />
          {email.trim() ? "Send invite" : "Create link"}
        </Button>
      </div>

      {/* Just-created link — surfaced once (token isn't re-exposed on the list). */}
      {lastUrl && (
        <div className="bg-ui-bg-subtle flex items-center gap-x-2 px-6 py-3">
          <Text size="xsmall" className="text-ui-fg-subtle flex-1 truncate">
            {lastUrl}
          </Text>
          <Button variant="transparent" size="small" onClick={() => copy(lastUrl)}>
            Copy link
          </Button>
        </div>
      )}

      {/* List */}
      <div className="flex flex-col gap-2 px-3 py-3">
        {isPending ? (
          <div className="flex items-center justify-center py-4">
            <Text size="small" className="text-ui-fg-subtle">
              Loading…
            </Text>
          </div>
        ) : invites.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <Text size="small" className="text-ui-fg-subtle">
              No invites yet — send one above.
            </Text>
          </div>
        ) : (
          invites.map((invite) => (
            <div
              key={invite.id}
              className="shadow-elevation-card-rest bg-ui-bg-component flex items-center gap-3 rounded-md px-4 py-2"
            >
              <div className="flex flex-1 flex-col overflow-hidden">
                <Text size="small" leading="compact" weight="plus" className="truncate">
                  {invite.email || "Shareable link"}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {invite.status === "accepted"
                    ? "Accepted"
                    : invite.status === "revoked"
                    ? "Revoked"
                    : relative(invite.expires_at)}
                </Text>
              </div>
              <Badge
                size="2xsmall"
                color={STATUS_COLOR[invite.status] || "grey"}
                rounded="full"
                className="capitalize"
              >
                {invite.status}
              </Badge>
              {invite.status === "pending" && (
                <Button
                  variant="transparent"
                  size="small"
                  onClick={() => handleRevoke(invite)}
                  aria-label="Revoke invite"
                >
                  <Trash className="text-ui-fg-muted" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </Container>
  )
}
