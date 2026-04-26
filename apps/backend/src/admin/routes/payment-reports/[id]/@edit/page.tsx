import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { Button, Input, Label, Textarea, toast } from "@medusajs/ui"
import { useParams, useNavigate } from "react-router-dom"
import { useState } from "react"
import { usePaymentReport, useUpdatePaymentReport } from "../../../../hooks/api/payment-reports"

const EditPaymentReportDrawer = () => {
  const { id } = useParams()
  const navigate = useNavigate()

  const { payment_report } = usePaymentReport(id!) as any
  const { mutateAsync, isPending } = useUpdatePaymentReport()

  const [name, setName] = useState<string>(() => payment_report?.name ?? "")
  const [metadataStr, setMetadataStr] = useState<string>(() =>
    payment_report?.metadata ? JSON.stringify(payment_report.metadata, null, 2) : "",
  )

  const onSave = async () => {
    let metadata: Record<string, any> | undefined
    if (metadataStr.trim()) {
      try {
        metadata = JSON.parse(metadataStr)
      } catch {
        toast.error("Invalid JSON in metadata field")
        return
      }
    }

    try {
      await mutateAsync({
        id: id!,
        name: name || undefined,
        metadata,
      })
      toast.success("Payment report updated")
      navigate("..", { replace: true })
    } catch (e: any) {
      toast.error(e?.message || "Failed to update report")
    }
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title>Edit Payment Report</RouteDrawer.Title>
        <RouteDrawer.Description>
          Update the name or metadata for this report.
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-col gap-y-4 pb-24">
        <div className="grid gap-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            placeholder="Report name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-y-2">
          <Label htmlFor="metadata">Metadata (JSON)</Label>
          <Textarea
            id="metadata"
            placeholder="{}"
            rows={6}
            value={metadataStr}
            onChange={(e) => setMetadataStr(e.target.value)}
          />
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer className="sticky bottom-0 bg-ui-bg-base border-t border-ui-border-base">
        <RouteDrawer.Close asChild>
          <Button variant="secondary" size="small">
            Cancel
          </Button>
        </RouteDrawer.Close>
        <Button size="small" onClick={onSave} isLoading={isPending}>
          Save
        </Button>
      </RouteDrawer.Footer>
    </RouteDrawer>
  )
}

export default EditPaymentReportDrawer
