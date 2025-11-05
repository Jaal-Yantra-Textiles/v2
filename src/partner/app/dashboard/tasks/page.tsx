import { Container, Heading, Text } from "@medusajs/ui"
import { getPartnerTasks } from "../actions"
import TasksTable, { PartnerTaskRow } from "./tasks-table"


export const dynamic = "force-dynamic"

export default async function TasksPage() {
  const res = await getPartnerTasks()
  const tasks = res?.tasks || []
  const count = res?.count || 0

  return (
    <Container className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <Heading level="h2">My Tasks</Heading>
        <Text size="small" className="text-ui-fg-subtle">{count} total</Text>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-md border border-ui-border-base p-8 text-center">
          <Text>No tasks assigned yet.</Text>
        </div>
      ) : (
        <TasksTable data={tasks as PartnerTaskRow[]} />
      )}
    </Container>
  )
}
