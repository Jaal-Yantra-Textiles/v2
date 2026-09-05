import { useState } from "react"
import { Button, Text } from "@medusajs/ui"
import { sdk } from "../../../lib/config"

/**
 * Per-row "Reveal" action for the census weavers view. Fetches a single
 * weaver's FULL PII from `GET /admin/census/weavers/:census_id/unmask`, which is
 * MFA-gated + audit-logged server-side. The full record is shown inline and is
 * NOT persisted anywhere client-side.
 */
export const WeaverRevealCell = ({ censusId }: { censusId: string | number }) => {
  const [state, setState] = useState<{
    status: "idle" | "loading" | "revealed" | "error"
    data?: Record<string, any> | null
    message?: string
  }>({ status: "idle" })

  const reveal = async () => {
    setState({ status: "loading" })
    try {
      const res = await sdk.client.fetch<{ weaver: Record<string, any> }>(
        `/admin/census/weavers/${censusId}/unmask`
      )
      setState({ status: "revealed", data: res.weaver })
    } catch (e: any) {
      const status = e?.response?.status
      const message =
        status === 403
          ? "MFA required to reveal"
          : status === 404
          ? "No record"
          : e?.message || "Reveal failed"
      setState({ status: "error", message })
    }
  }

  return (
    <div className="flex flex-col gap-y-1">
      <Button size="small" variant="secondary" onClick={reveal} isLoading={state.status === "loading"}>
        Reveal
      </Button>
      {state.status === "revealed" && state.data ? (
        <pre className="text-ui-fg-subtle text-xs whitespace-pre-wrap break-all max-w-sm max-h-40 overflow-auto rounded border border-ui-border-base p-2">
          {JSON.stringify(state.data, null, 2)}
        </pre>
      ) : null}
      {state.status === "error" ? (
        <Text size="xsmall" className="text-ui-fg-error">
          {state.message}
        </Text>
      ) : null}
    </div>
  )
}