import { Container, Heading, Switch, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { sdk } from "../../lib/config"

type SubscriptionResponse = {
  subscribed: boolean
  blocked_by: "bounced" | "unsubscribed" | null
  subscription: { email_subscribed: string; subscription_status: string } | null
}

/**
 * Whether this person gets the blog newsletter. Until this switch, only the
 * website signup form could subscribe someone, so people added here were
 * never mailed and nothing said so.
 */
export const PersonNewsletterSection = ({ personId, email }: { personId: string; email?: string | null }) => {
  const queryClient = useQueryClient()
  const queryKey = ["persons", personId, "subscription"]
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      sdk.client.fetch<SubscriptionResponse>(`/admin/persons/${personId}/subscription`, { method: "GET" }),
  })
  const save = useMutation({
    mutationFn: (subscribed: boolean) =>
      sdk.client.fetch<SubscriptionResponse>(`/admin/persons/${personId}/subscription`, {
        method: "POST",
        body: { subscribed },
      }),
    onSuccess: (_r, subscribed) => {
      queryClient.invalidateQueries({ queryKey })
      toast.success(subscribed ? "Subscribed: they'll get the next newsletter" : "Unsubscribed from the newsletter")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const subscribed = !!data?.subscribed
  const note = !email
    ? "No email address on this person."
    : data?.blocked_by === "unsubscribed"
      ? "They unsubscribed themselves; only the signup form can re-join them."
      : data?.blocked_by === "bounced"
        ? "Their address bounced, so the newsletter skips them."
        : subscribed
          ? `Gets the blog newsletter at ${data?.subscription?.email_subscribed ?? email}.`
          : "Not on the newsletter."

  return (
    <Container className="flex items-start justify-between gap-4 px-6 py-4">
      <div className="flex flex-col gap-1">
        <Heading level="h2">Newsletter</Heading>
        <Text size="small" className="text-ui-fg-subtle">{isLoading ? "Loading…" : note}</Text>
      </div>
      <Switch
        aria-label="Newsletter"
        checked={subscribed}
        disabled={isLoading || save.isPending || !email || data?.blocked_by === "unsubscribed"}
        onCheckedChange={(v) => save.mutate(v)}
      />
    </Container>
  )
}
