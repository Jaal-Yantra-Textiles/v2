import { Container, Heading, Tabs, Text, Badge } from "@medusajs/ui"
import { LoaderFunctionArgs, UIMatch, useLoaderData, useParams } from "react-router-dom"

import { TwoColumnPage } from "../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton"
import { productionRunLoader } from "./loader"

const statusColor = (status?: string) => {
  switch (status) {
    case "draft":
      return "grey"
    case "pending_review":
      return "orange"
    case "approved":
      return "green"
    case "sent_to_partner":
      return "orange"
    case "in_progress":
      return "orange"
    case "completed":
      return "green"
    case "cancelled":
      return "red"
    default:
      return "grey"
  }
}

const ProductionRunDetailPage = () => {
  const { id } = useParams()
  const initialData = useLoaderData() as Awaited<{ production_run: any; tasks: any[] }>

  const run = initialData?.production_run
  const tasks = initialData?.tasks || []

  if (!id || !run) {
    return <TwoColumnPageSkeleton mainSections={1} sidebarSections={1} showJSON showMetadata />
  }

  return (
    <TwoColumnPage data={run} hasOutlet={true} showJSON showMetadata>
      <TwoColumnPage.Main>
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex flex-col gap-y-1">
              <div className="flex items-center gap-x-2">
                <Heading level="h1">{String(run.id)}</Heading>
                <Badge color={statusColor(run.status)}>{String(run.status || "-")}</Badge>
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                Design: {String(run.design_id || "-")}
              </Text>
            </div>
          </div>

          <div className="px-6 py-4">
            <Tabs defaultValue="overview">
              <Tabs.List>
                <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
                <Tabs.Trigger value="tasks">Tasks ({tasks.length})</Tabs.Trigger>
                <Tabs.Trigger value="snapshot">Snapshot</Tabs.Trigger>
              </Tabs.List>

              <Tabs.Content value="overview" className="mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Text size="small" className="text-ui-fg-subtle">Partner</Text>
                    <Text>{String(run.partner_id || "-")}</Text>
                  </div>
                  <div>
                    <Text size="small" className="text-ui-fg-subtle">Quantity</Text>
                    <Text>{String(run.quantity ?? "-")}</Text>
                  </div>
                  <div>
                    <Text size="small" className="text-ui-fg-subtle">Role</Text>
                    <Text>{String(run.role || "-")}</Text>
                  </div>
                  <div>
                    <Text size="small" className="text-ui-fg-subtle">Parent Run</Text>
                    <Text>{String(run.parent_run_id || "-")}</Text>
                  </div>
                </div>
              </Tabs.Content>

              <Tabs.Content value="tasks" className="mt-4">
                {!tasks.length ? (
                  <Text size="small" className="text-ui-fg-subtle">No tasks</Text>
                ) : (
                  <div className="flex flex-col gap-y-2">
                    {tasks.map((t: any) => (
                      <div key={String(t.id)} className="rounded-md border px-3 py-2">
                        <div className="flex items-center justify-between gap-x-2">
                          <Text weight="plus" size="small">
                            {String(t.title || t.name || t.id)}
                          </Text>
                          <Badge color={statusColor(String(t.status || ""))}>
                            {String(t.status || "-")}
                          </Badge>
                        </div>
                        {t.description && (
                          <Text size="small" className="text-ui-fg-subtle">
                            {String(t.description)}
                          </Text>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Tabs.Content>

              <Tabs.Content value="snapshot" className="mt-4">
                {run.snapshot ? (
                  <pre className="rounded-md border p-3 overflow-auto text-xs">
                    {JSON.stringify(run.snapshot, null, 2)}
                  </pre>
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">No snapshot</Text>
                )}
              </Tabs.Content>
            </Tabs>
          </div>
        </Container>
      </TwoColumnPage.Main>

      <TwoColumnPage.Sidebar>
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Details</Heading>
          </div>
          <div className="px-6 py-4 grid grid-cols-1 gap-3">
            <div>
              <Text size="small" className="text-ui-fg-subtle">Created</Text>
              <Text>{String(run.created_at || "-")}</Text>
            </div>
            <div>
              <Text size="small" className="text-ui-fg-subtle">Updated</Text>
              <Text>{String(run.updated_at || "-")}</Text>
            </div>
          </div>
        </Container>
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params
    return `${id}`
  },
}

export async function loader({ params }: LoaderFunctionArgs) {
  return await productionRunLoader({ params })
}

export default ProductionRunDetailPage
