import { useState } from "react"
import { Button, Container, Heading, Text } from "@medusajs/ui"

import { sdk } from "../../lib/config"

/**
 * Section-level "Reveal" for the weaver detail view. Fetches one weaver's FULL
 * PII from `GET /admin/census/weavers/:census_id/unmask`, which is MFA-gated +
 * audit-logged server-side. The full record is shown inline and never persisted.
 */
export const WeaverRevealSection = ({ censusId }: { censusId: string | number }) => {
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
          ? "MFA required to reveal full PII"
          : status === 404
          ? "No record"
          : e?.message || "Reveal failed"
      setState({ status: "error", message })
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col px-6 py-4">
        <Heading level="h2">Full PII</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          MFA-gated reveal from the encrypted sensitive core
        </Text>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Button
          size="small"
          variant="secondary"
          className="w-fit"
          onClick={reveal}
          isLoading={state.status === "loading"}
        >
          Reveal
        </Button>
        {state.status === "error" ? (
          <Text size="small" className="text-ui-fg-error">
            {state.message}
          </Text>
        ) : null}
        {state.status === "revealed" && state.data ? (
          <pre className="text-ui-fg-subtle mt-2 whitespace-pre-wrap break-all rounded border border-ui-border-base p-2 text-xs">
            {JSON.stringify(state.data, null, 2)}
          </pre>
        ) : null}
      </div>
    </Container>
  )
}