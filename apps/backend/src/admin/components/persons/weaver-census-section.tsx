import { Container, Heading, Text } from "@medusajs/ui"

import { AdminWeaver } from "../../hooks/api/personandtype"

// Already shown in the general section / header — don't repeat them here.
const EXCLUDED = new Set([
  "census_id",
  "district",
  "state",
  "gender",
  "age",
  "education",
  "village",
  "block",
  "mobile_masked",
])

const fmt = (v: any): string => (typeof v === "boolean" ? (v ? "Yes" : "No") : String(v))

export const WeaverCensusSection = ({ weaver }: { weaver: AdminWeaver }) => {
  const scalar = Object.entries(weaver).filter(
    ([k, v]) => !EXCLUDED.has(k) && v != null && v !== "" && typeof v !== "object"
  )
  const objects = Object.entries(weaver).filter(
    ([k, v]) => !EXCLUDED.has(k) && v != null && typeof v === "object"
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col px-6 py-4">
        <Heading level="h2">Census details</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Additional survey fields for this weaver
        </Text>
      </div>
      {scalar.length === 0 && objects.length === 0 ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            No additional fields
          </Text>
        </div>
      ) : null}
      {scalar.map(([k, v]) => (
        <div key={k} className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            {k.replace(/_/g, " ")}
          </Text>
          <Text size="small" leading="compact">
            {fmt(v)}
          </Text>
        </div>
      ))}
      {objects.map(([k, v]) => (
        <div key={k} className="px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            {k.replace(/_/g, " ")}
          </Text>
          <pre className="text-ui-fg-subtle mt-2 whitespace-pre-wrap break-all rounded border border-ui-border-base p-2 text-xs">
            {JSON.stringify(v, null, 2)}
          </pre>
        </div>
      ))}
    </Container>
  )
}