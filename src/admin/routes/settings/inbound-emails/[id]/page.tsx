import {
  Badge,
  Button,
  Container,
  Heading,
  Label,
  Select,
  Text,
  Toaster,
  toast,
} from "@medusajs/ui"
import { useParams, UIMatch } from "react-router-dom"
import { useMemo, useRef, useState } from "react"
import {
  useInboundEmail,
  useInboundEmailActions,
  useExtractInboundEmail,
  useIgnoreInboundEmail,
} from "../../../../hooks/api/inbound-emails"
import { ExecuteActionDialog } from "../../../../components/inbound-emails/execute-action-dialog"

const STATUS_COLORS: Record<string, "green" | "orange" | "blue" | "grey"> = {
  received: "blue",
  action_pending: "orange",
  processed: "green",
  ignored: "grey",
}

const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  action_pending: "Action Pending",
  processed: "Processed",
  ignored: "Ignored",
}

export default function InboundEmailDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { inbound_email, isLoading } = useInboundEmail(id!)
  const { actions } = useInboundEmailActions()
  const [selectedAction, setSelectedAction] = useState<string>("")
  const [showExecuteDialog, setShowExecuteDialog] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const { mutate: extract, isPending: isExtracting } = useExtractInboundEmail(id!, {
    onSuccess: () => {
      toast.success("Data extracted successfully")
    },
    onError: (err) => toast.error(err.message || "Extraction failed"),
  })

  const { mutate: ignore, isPending: isIgnoring } = useIgnoreInboundEmail(id!, {
    onSuccess: () => toast.success("Email marked as ignored"),
    onError: (err) => toast.error(err.message || "Failed to ignore"),
  })

  const sanitizedHtml = useMemo(() => {
    if (!inbound_email?.html_body) return ""
    return inbound_email.html_body
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/on\w+="[^"]*"/gi, "")
      .replace(/on\w+='[^']*'/gi, "")
  }, [inbound_email?.html_body])

  if (isLoading || !inbound_email) {
    return (
      <div className="flex flex-col gap-y-4">
        {[1, 2, 3].map((i) => (
          <Container key={i} className="p-6">
            <div className="animate-pulse space-y-3">
              <div className="h-5 bg-ui-bg-subtle rounded w-1/3" />
              <div className="h-4 bg-ui-bg-subtle rounded w-2/3" />
              <div className="h-4 bg-ui-bg-subtle rounded w-1/2" />
            </div>
          </Container>
        ))}
      </div>
    )
  }

  const receivedDate = new Date(inbound_email.received_at).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  })

  const toAddresses = Array.isArray(inbound_email.to_addresses)
    ? inbound_email.to_addresses.join(", ")
    : "—"

  return (
    <>
      <Toaster />
      <div className="flex flex-col gap-y-4">

        {/* Header */}
        <Container className="divide-y p-0">
          <div className="flex items-start justify-between px-6 py-4">
            <div className="flex items-center gap-x-3">
              <Heading>{inbound_email.subject || "(no subject)"}</Heading>
              <Badge
                color={STATUS_COLORS[inbound_email.status] || "grey"}
                size="2xsmall"
              >
                {STATUS_LABELS[inbound_email.status] ?? inbound_email.status}
              </Badge>
            </div>
            {inbound_email.status !== "ignored" && inbound_email.status !== "processed" && (
              <Button
                size="small"
                variant="secondary"
                onClick={() => ignore()}
                isLoading={isIgnoring}
              >
                Ignore
              </Button>
            )}
          </div>

          {/* Metadata rows */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0 px-6 py-4">
            <MetaRow label="From" value={inbound_email.from_address} mono />
            <MetaRow label="To" value={toAddresses} mono />
            <MetaRow label="Received" value={receivedDate} />
            <MetaRow label="Source" value={
              inbound_email.folder === "resend_inbound"
                ? <Badge color="purple" size="2xsmall">Resend</Badge>
                : <span>{inbound_email.folder}</span>
            } />
            {inbound_email.message_id && (
              <MetaRow
                label="Message-ID"
                value={inbound_email.message_id}
                mono
                className="sm:col-span-2"
              />
            )}
          </div>
        </Container>

        {/* Email Body */}
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Email Body</Heading>
          </div>
          <div className="px-6 py-4">
            {sanitizedHtml ? (
              <div className="border rounded-lg overflow-hidden bg-white">
                <iframe
                  ref={iframeRef}
                  srcDoc={sanitizedHtml}
                  sandbox="allow-same-origin"
                  className="w-full min-h-[400px] border-0"
                  title="Email body preview"
                  onLoad={() => {
                    if (iframeRef.current?.contentDocument) {
                      const height = iframeRef.current.contentDocument.body.scrollHeight
                      iframeRef.current.style.height = `${Math.min(height + 20, 800)}px`
                    }
                  }}
                />
              </div>
            ) : inbound_email.text_body ? (
              <pre className="whitespace-pre-wrap text-sm text-ui-fg-base font-sans bg-ui-bg-subtle rounded-lg p-4 overflow-auto max-h-[600px]">
                {inbound_email.text_body}
              </pre>
            ) : (
              <Text className="text-ui-fg-muted italic">No body content.</Text>
            )}
          </div>
        </Container>

        {/* Actions */}
        {inbound_email.status !== "ignored" && (
          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h2">Actions</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Select an action type, extract the relevant data, then execute.
              </Text>
            </div>
            <div className="px-6 py-4">
              <div className="flex items-end gap-x-3">
                <div className="flex flex-col gap-y-1 w-64">
                  <Label size="small" weight="plus">Action Type</Label>
                  <Select
                    value={selectedAction}
                    onValueChange={setSelectedAction}
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Select an action..." />
                    </Select.Trigger>
                    <Select.Content>
                      {(actions ?? []).map((a) => (
                        <Select.Item key={a.type} value={a.type}>
                          {a.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={!selectedAction}
                  isLoading={isExtracting}
                  onClick={() => {
                    if (selectedAction) {
                      extract({ action_type: selectedAction })
                    }
                  }}
                >
                  Extract Data
                </Button>
                {inbound_email.extracted_data && inbound_email.status !== "processed" && (
                  <Button
                    size="small"
                    disabled={!inbound_email.action_type}
                    onClick={() => setShowExecuteDialog(true)}
                  >
                    Execute Action
                  </Button>
                )}
              </div>

              {inbound_email.error_message && (
                <div className="mt-4 rounded-lg bg-ui-bg-field-error p-4 text-sm text-ui-fg-error">
                  {inbound_email.error_message}
                </div>
              )}
            </div>
          </Container>
        )}

        {/* Extracted Data */}
        {inbound_email.extracted_data && (
          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h2">Extracted Data</Heading>
            </div>
            <div className="px-6 py-4">
              <pre className="bg-ui-bg-subtle rounded-lg p-4 text-sm overflow-auto max-h-[400px]">
                {JSON.stringify(inbound_email.extracted_data, null, 2)}
              </pre>
            </div>
          </Container>
        )}

        {/* Action Result */}
        {inbound_email.action_result && (
          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h2">Action Result</Heading>
            </div>
            <div className="px-6 py-4">
              <pre className="bg-ui-bg-subtle rounded-lg p-4 text-sm overflow-auto max-h-[400px]">
                {JSON.stringify(inbound_email.action_result, null, 2)}
              </pre>
            </div>
          </Container>
        )}
      </div>

      {showExecuteDialog && inbound_email.action_type && (
        <ExecuteActionDialog
          emailId={id!}
          actionType={inbound_email.action_type}
          extractedData={inbound_email.extracted_data}
          onClose={() => setShowExecuteDialog(false)}
        />
      )}
    </>
  )
}

// ─── Helper component ────────────────────────────────────────────────────────

function MetaRow({
  label,
  value,
  mono = false,
  className = "",
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-y-0.5 py-2 ${className}`}>
      <Text size="xsmall" className="text-ui-fg-muted font-medium uppercase tracking-wide">
        {label}
      </Text>
      {typeof value === "string" ? (
        <Text
          size="small"
          className={`text-ui-fg-base ${mono ? "font-mono text-xs" : ""}`}
        >
          {value || "—"}
        </Text>
      ) : (
        value
      )}
    </div>
  )
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    return match.params.id || "Detail"
  },
}
