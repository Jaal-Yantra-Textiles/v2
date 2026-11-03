import { Badge, Button, Heading, Input, Label, Text, Textarea, toast } from "@medusajs/ui"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import {
  useSendCompanyUpdate,
  type SendCompanyUpdateResponse,
} from "../../../../hooks/api/investor-financials-admin"

type FormValues = { subject: string; message: string; sender_name: string }

/**
 * A letter from the company to its investors, sent through the platform email
 * service. Always previews first — the Send button only appears once the
 * preview shows exactly who will get it — and each investor gets their own
 * email, so no one sees another's address.
 */
const SendUpdateForm = ({ companyId }: { companyId: string }) => {
  const { handleSuccess } = useRouteModal()
  const [preview, setPreview] = useState<SendCompanyUpdateResponse | null>(null)
  const form = useForm<FormValues>({
    defaultValues: { subject: "", message: "", sender_name: "" },
  })
  const { mutateAsync, isPending } = useSendCompanyUpdate(companyId)

  const body = (v: FormValues) => ({
    subject: v.subject,
    message: v.message,
    ...(v.sender_name.trim() ? { sender_name: v.sender_name.trim() } : {}),
  })

  const onPreview = form.handleSubmit(async (v) => {
    try {
      setPreview(await mutateAsync(body(v)))
    } catch (e: any) {
      toast.error(e?.message || "Could not preview the update")
    }
  })

  const onSend = form.handleSubmit(async (v) => {
    try {
      const res = await mutateAsync({ ...body(v), confirm: true })
      if (res.failed) {
        toast.warning(`Sent to ${res.sent}; ${res.failed} failed — see the email log`)
      } else {
        toast.success(`Update sent to ${res.sent} investor${res.sent === 1 ? "" : "s"}`)
      }
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Could not send the update")
    }
  })

  // Every field clears the preview on change, so Send only ever sends the
  // exact letter the admin last previewed.
  const canSend = !!preview && preview.template_ready && preview.recipients.length > 0

  return (
    <form onSubmit={onPreview} className="flex flex-1 flex-col overflow-hidden">
      <RouteFocusModal.Header>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteFocusModal.Close>
          <Button size="small" variant="secondary" type="submit" isLoading={isPending && !canSend}>
            Preview
          </Button>
          {canSend && (
            <Button size="small" type="button" onClick={onSend} isLoading={isPending}>
              Send to {preview!.recipients.length} investor{preview!.recipients.length === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-auto py-8">
        <div className="flex w-full max-w-2xl flex-col gap-y-6">
          <div>
            <Heading level="h2">Send an update to investors</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Each investor gets their own email from investors@jaalyantra.com, with a link to the investor portal.
            </Text>
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Subject</Label>
            <Input
              placeholder="Updated shareholding after our loan conversion"
              {...form.register("subject", { required: true, onChange: () => setPreview(null) })}
            />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Message</Label>
            <Textarea
              rows={12}
              placeholder={"Write in plain text.\n\nA blank line starts a new paragraph.\n- Lines starting with a dash become a list\nLinks like https://… become clickable."}
              {...form.register("message", { required: true, onChange: () => setPreview(null) })}
            />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Signed by</Label>
            <Input
              placeholder="Defaults to your name"
              {...form.register("sender_name", { onChange: () => setPreview(null) })}
            />
          </div>

          {preview && (
            <div className="flex flex-col gap-y-4 rounded-lg border p-4">
              <Text weight="plus">Preview</Text>
              {!preview.template_ready && (
                <Text size="small" className="text-ui-fg-error">
                  The "investor-update" email template is missing — create it under Email templates before sending.
                </Text>
              )}
              <div className="flex flex-col gap-y-1">
                <Text size="small" weight="plus">Goes to ({preview.recipients.length})</Text>
                {preview.recipients.map((r) => (
                  <Text key={r.investor_id} size="small">{r.name} · {r.email}</Text>
                ))}
              </div>
              {preview.skipped.length > 0 && (
                <div className="flex flex-col gap-y-1">
                  <Text size="small" weight="plus">Left out ({preview.skipped.length})</Text>
                  {preview.skipped.map((s) => (
                    <div key={s.investor_id} className="flex items-center gap-x-2">
                      <Text size="small">{s.name}</Text>
                      <Badge size="2xsmall" color="grey">{s.reason}</Badge>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-y-1">
                <Text size="small" weight="plus">{preview.subject}</Text>
                {/* body_html is built server-side from HTML-escaped text. */}
                <div
                  className="text-ui-fg-subtle text-sm [&_a]:underline [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
                  dangerouslySetInnerHTML={{ __html: preview.body_html }}
                />
                <Text size="small" className="text-ui-fg-subtle">
                  {preview.sender_name}, {preview.company_name}
                </Text>
              </div>
            </div>
          )}
        </div>
      </RouteFocusModal.Body>
    </form>
  )
}

const SendUpdatePage = () => {
  const { id } = useParams()
  return (
    <RouteFocusModal>
      <SendUpdateForm companyId={id!} />
    </RouteFocusModal>
  )
}

export default SendUpdatePage
