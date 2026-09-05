import { Container, Heading, Text } from "@medusajs/ui"

import { AdminWeaver } from "../../hooks/api/personandtype"

const GENERAL_FIELDS: { label: string; key: string }[] = [
  { label: "District", key: "district" },
  { label: "State", key: "state" },
  { label: "Gender", key: "gender" },
  { label: "Age", key: "age" },
  { label: "Education", key: "education" },
  { label: "Village", key: "village" },
  { label: "Block", key: "block" },
  { label: "Mobile (masked)", key: "mobile_masked" },
]

const fmt = (v: any): string => (typeof v === "boolean" ? (v ? "Yes" : "No") : String(v))

export const WeaverGeneralSection = ({ weaver }: { weaver: AdminWeaver }) => {
  const rows = GENERAL_FIELDS.filter(
    ({ key }) => (weaver as any)[key] != null && (weaver as any)[key] !== ""
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col px-6 py-4">
        <Heading>Weaver #{weaver.census_id}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Handloom census record (masked)
        </Text>
      </div>
      {rows.map(({ label, key }) => (
        <div key={key} className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            {label}
          </Text>
          <Text size="small" leading="compact">
            {fmt((weaver as any)[key])}
          </Text>
        </div>
      ))}
    </Container>
  )
}