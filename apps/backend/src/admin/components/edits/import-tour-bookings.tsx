import { useState } from "react"
import { Button, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useRouteModal } from "../modal/use-route-modal"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { useImportTourBookings, type ImportTourBookingsResponse } from "../../hooks/api/forms"

type Props = { formId: string }

export const ImportTourBookingsComponent = ({ formId }: Props) => {
  const [file, setFile] = useState<File | null>(null)
  const [tokenTtlDays, setTokenTtlDays] = useState<string>("60")
  const [result, setResult] = useState<ImportTourBookingsResponse | null>(null)
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useImportTourBookings(formId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) {
      toast.error("Pick an xlsx file first")
      return
    }
    try {
      const ttl = parseInt(tokenTtlDays, 10)
      const res = await mutateAsync({
        file,
        tokenTtlDays: Number.isFinite(ttl) ? ttl : undefined,
      })
      setResult(res)
      toast.success(
        `Imported ${res.created_count} booking${res.created_count === 1 ? "" : "s"}` +
          (res.skipped_count ? `, skipped ${res.skipped_count}` : "")
      )
    } catch (err: any) {
      toast.error(err?.message || "Import failed")
    }
  }

  return (
    <KeyboundForm onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
      <RouteFocusModal.Header>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              {result ? "Close" : "Cancel"}
            </Button>
          </RouteFocusModal.Close>
          {!result ? (
            <Button
              size="small"
              variant="primary"
              type="submit"
              isLoading={isPending}
              disabled={!file}
            >
              Import
            </Button>
          ) : (
            <Button
              size="small"
              variant="primary"
              type="button"
              onClick={() => handleSuccess()}
            >
              Done
            </Button>
          )}
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-col items-center overflow-y-auto p-10">
        <div className="flex w-full max-w-[640px] flex-col gap-y-6">
          <div>
            <Heading>Import tour bookings</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Upload a GetYourGuide bookings xlsx export. One form response is
              created per booking with a unique visit token.
            </Text>
          </div>

          {!result ? (
            <>
              <div className="flex flex-col gap-y-2">
                <Label htmlFor="tour-bookings-file">XLSX file</Label>
                <Input
                  id="tour-bookings-file"
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Selected: {file.name} ({Math.round(file.size / 1024)} KB)
                  </Text>
                ) : null}
              </div>

              <div className="flex flex-col gap-y-2">
                <Label htmlFor="tour-bookings-ttl">Visit token TTL (days from tour date)</Label>
                <Input
                  id="tour-bookings-ttl"
                  type="number"
                  min={1}
                  max={3650}
                  value={tokenTtlDays}
                  onChange={(e) => setTokenTtlDays(e.target.value)}
                />
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Tokens stay valid until the tour date plus this many days. Default 60.
                </Text>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-y-3 rounded-md border bg-ui-bg-subtle p-4">
              <div className="grid grid-cols-2 gap-2">
                <Text size="small" className="text-ui-fg-subtle">Created</Text>
                <Text size="small" weight="plus">{result.created_count}</Text>
                <Text size="small" className="text-ui-fg-subtle">Skipped (already imported)</Text>
                <Text size="small" weight="plus">{result.skipped_count}</Text>
              </div>
              {result.skipped_booking_refs.length > 0 ? (
                <div>
                  <Text size="xsmall" className="text-ui-fg-subtle">Skipped booking refs:</Text>
                  <Text size="xsmall" className="break-all font-mono">
                    {result.skipped_booking_refs.join(", ")}
                  </Text>
                </div>
              ) : null}
              <Text size="small" className="text-ui-fg-subtle">
                Visit tokens are now stored as <code>verification_code</code> on the new
                form responses. Open the responses list below to copy share links.
              </Text>
            </div>
          )}
        </div>
      </RouteFocusModal.Body>
    </KeyboundForm>
  )
}
