import { LoaderFunctionArgs, UIMatch, useParams, useNavigate } from "react-router-dom"
import {
  Container,
  Heading,
  Button,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { HeadingSkeleton, TextSkeleton } from "../../../components/table/skeleton"
import { Plus, Trash } from "@medusajs/icons"
import { statsDashboardLoader } from "./loader"
import { useState } from "react"
import {
  useDashboard,
  useDeleteDashboard,
  StatsPanel,
} from "../../../hooks/api/stats"
import { PanelCard } from "../../../components/stats/panel-card"
import { PanelEditorDrawer } from "../../../components/stats/panel-editor-drawer"

const DashboardDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const prompt = usePrompt()
  const { data: dashboard, isLoading, isError, error } = useDashboard(id)
  const deleteDashboard = useDeleteDashboard()

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingPanel, setEditingPanel] = useState<StatsPanel | undefined>()

  if (isError) throw error

  const handleAddPanel = () => {
    setEditingPanel(undefined)
    setEditorOpen(true)
  }

  const handleEditPanel = (panel: StatsPanel) => {
    setEditingPanel(panel)
    setEditorOpen(true)
  }

  const handleDeleteDashboard = async () => {
    const confirmed = await prompt({
      title: "Delete dashboard",
      description: `Delete "${dashboard?.name}" and all its panels?`,
      confirmText: "Delete",
      cancelText: "Cancel",
    })
    if (!confirmed || !id) return
    deleteDashboard.mutate(id, {
      onSuccess: () => {
        toast.success("Dashboard deleted")
        navigate("/stats")
      },
      onError: (e) => toast.error(`Failed: ${e.message}`),
    })
  }

  const panels = (dashboard?.panels ?? []) as StatsPanel[]

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="p-0">
        <div className="flex justify-between items-center px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-y-1">
              {isLoading && !dashboard ? (
                <>
                  <HeadingSkeleton level="h1" characters={18} />
                  <TextSkeleton size="small" characters={32} />
                </>
              ) : (
                <>
                  <Heading>{dashboard?.name ?? ""}</Heading>
                  {dashboard?.description && (
                    <Text size="small" className="text-ui-fg-subtle">
                      {dashboard.description}
                    </Text>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="small" variant="secondary" onClick={handleDeleteDashboard}>
              <Trash /> Delete
            </Button>
            <Button size="small" variant="primary" onClick={handleAddPanel}>
              <Plus /> Add panel
            </Button>
          </div>
        </div>
      </Container>

      {panels.length === 0 ? (
        <Container className="p-12 flex flex-col items-center justify-center text-center">
          <Text className="text-ui-fg-subtle mb-4">
            No panels yet. Add your first panel to start visualizing data.
          </Text>
          <Button size="small" variant="primary" onClick={handleAddPanel}>
            <Plus /> Add panel
          </Button>
        </Container>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {panels.map((panel) => (
            <div
              key={panel.id}
              className="min-h-[200px]"
              style={{
                gridColumn: `span ${Math.min(12, Math.max(1, panel.width ?? 4))}`,
              }}
            >
              <PanelCard panel={panel} onEdit={handleEditPanel} />
            </div>
          ))}
        </div>
      )}

      {id && (
        <PanelEditorDrawer
          dashboardId={id}
          panel={editingPanel}
          open={editorOpen}
          onOpenChange={setEditorOpen}
        />
      )}
    </div>
  )
}

export default DashboardDetailPage

export async function loader({ params }: LoaderFunctionArgs) {
  return statsDashboardLoader({ params } as LoaderFunctionArgs)
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const data = match.data as { dashboard?: { name?: string } } | undefined
    return data?.dashboard?.name ?? match.params.id
  },
}
