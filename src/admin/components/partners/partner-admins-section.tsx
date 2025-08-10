import { Badge, Container, Heading, Text, Table } from "@medusajs/ui"

export type AdminPartnerAdmin = {
  id: string
  email: string
  first_name?: string
  last_name?: string
  phone?: string
  role?: "owner" | "admin" | "manager"
}

export const PartnerAdminsSection = ({ admins = [] as AdminPartnerAdmin[] }) => {
  const count = admins.length
  return (
    <Container className="divide-y p-0 w-full">
      <div className="flex items-start justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Admins</Heading>
          <Badge size="2xsmall" className="ml-2">{count}</Badge>
        </div>
        <Text size="small" className="text-ui-fg-subtle">People who administer this partner</Text>
      </div>
      <div className="px-0 py-4 w-full overflow-x-auto">
        <Table className="w-full">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Email</Table.HeaderCell>
              <Table.HeaderCell>Role</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {count === 0 ? (
              <Table.Row>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle">No admins added yet.</Text>
                </Table.Cell>
                <Table.Cell />
                <Table.Cell />
              </Table.Row>
            ) : (
              admins.map((a) => (
                <Table.Row key={a.id}>
                  <Table.Cell>{[a.first_name, a.last_name].filter(Boolean).join(" ") || "—"}</Table.Cell>
                  <Table.Cell>{a.email}</Table.Cell>
                  <Table.Cell>{a.role || "admin"}</Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
    </Container>
  )
}
