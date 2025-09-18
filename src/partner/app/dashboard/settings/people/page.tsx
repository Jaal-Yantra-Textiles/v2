import { Container, Heading, Text } from "@medusajs/ui"
import { getPartnerPeople } from "../../actions"
import PeopleTable from "./people-table"


export default async function PeopleSettingsPage() {
  const people = await getPartnerPeople()
  return (
    <div className="flex flex-col gap-y-6">
      <div>
        <Heading level="h1">People</Heading>
        <Text className="text-ui-fg-subtle">Manage team members associated with your partner account.</Text>
      </div>
      <Container className="p-0">
        <PeopleTable data={people} />
      </Container>
    </div>
  )
}
