import {
  Badge,
  Button,
  Container,
  Heading,
  Prompt,
  Skeleton,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  useAgreement,
  useSignAgreement,
  type AgreementDetail,
} from "../../../hooks/api/investments"

const statusColor = (s?: AgreementDetail["status"]) =>
  s === "agreed"
    ? "green"
    : s === "disagreed"
    ? "red"
    : s === "viewed"
    ? "blue"
    : "orange"

const statusLabel = (s?: AgreementDetail["status"]) =>
  s === "agreed"
    ? "Signed"
    : s === "disagreed"
    ? "Declined"
    : s === "expired"
    ? "Expired"
    : "Awaiting your signature"

export const Component = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { agreement, isPending } = useAgreement(id)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const { mutateAsync, isPending: isSigning } = useSignAgreement(id || "", {
    onSuccess: (data) => {
      toast.success(
        data.agreement.agreed ? "Agreement signed" : "Agreement declined"
      )
    },
    onError: (e: any) => toast.error(e?.message || "Could not submit"),
  })

  const canSign =
    agreement?.status === "sent" || agreement?.status === "viewed"

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-start justify-between gap-x-4">
        <div>
          <Heading level="h1">
            {agreement?.instrument_label || agreement?.title || "Agreement"}
          </Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            {[agreement?.company_name, agreement?.deal_name, agreement?.amount_formatted]
              .filter(Boolean)
              .join(" · ") || "Subscription agreement"}
          </Text>
        </div>
        {agreement && (
          <Badge color={statusColor(agreement.status)}>
            {statusLabel(agreement.status)}
          </Badge>
        )}
      </div>

      <Container className="p-0">
        {isPending ? (
          <div className="flex flex-col gap-y-3 p-6">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !agreement ? (
          <div className="p-6">
            <Text size="small" className="text-ui-fg-subtle">
              Agreement not found.
            </Text>
          </div>
        ) : (
          <div
            className="agreement-body p-6 sm:p-8"
            // Body is our own server-rendered, Handlebars-compiled HTML.
            dangerouslySetInnerHTML={{ __html: agreement.content || "" }}
          />
        )}
      </Container>

      {agreement && (
        <div className="flex items-center justify-end gap-x-2">
          <Button variant="secondary" onClick={() => navigate("/agreements")}>
            Back
          </Button>
          {canSign ? (
            <>
              <Button
                variant="danger"
                isLoading={isSigning}
                onClick={() => mutateAsync({ agreed: false })}
              >
                Decline
              </Button>
              <Prompt open={confirmOpen} onOpenChange={setConfirmOpen}>
                <Prompt.Trigger asChild>
                  <Button>I agree & sign</Button>
                </Prompt.Trigger>
                <Prompt.Content>
                  <Prompt.Header>
                    <Prompt.Title>Sign this agreement?</Prompt.Title>
                    <Prompt.Description>
                      By signing you confirm you have read and accept the terms
                      of this {agreement.instrument_label || "agreement"}. This
                      action is recorded and cannot be undone.
                    </Prompt.Description>
                  </Prompt.Header>
                  <Prompt.Footer>
                    <Prompt.Cancel>Cancel</Prompt.Cancel>
                    <Prompt.Action
                      onClick={async () => {
                        await mutateAsync({ agreed: true })
                        setConfirmOpen(false)
                      }}
                    >
                      Sign
                    </Prompt.Action>
                  </Prompt.Footer>
                </Prompt.Content>
              </Prompt>
            </>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">
              {agreement.status === "agreed"
                ? `Signed${agreement.responded_at ? " on " + new Date(agreement.responded_at).toLocaleDateString() : ""}`
                : agreement.status === "disagreed"
                ? "You declined this agreement"
                : "This agreement can no longer be signed"}
            </Text>
          )}
        </div>
      )}
    </div>
  )
}
