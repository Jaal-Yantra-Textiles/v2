import { useState, useContext } from "react"
import { EditorContext, type Editor } from "@tiptap/react"
import {
  FocusModal,
  Button,
  Heading,
  Text,
  Input,
  Badge,
} from "@medusajs/ui"
import { ChartBar } from "@medusajs/icons"
import { useDashboards, useDashboard, StatsPanel } from "../../hooks/api/stats"

type StatsPanelPickerProps = {
  editor?: Editor | null
}

export function StatsPanelPickerButton({ editor: editorProp }: StatsPanelPickerProps = {}) {
  const context = useContext(EditorContext)
  const editor = editorProp ?? context?.editor ?? null
  const [open, setOpen] = useState(false)
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  const { data: dashboardsData } = useDashboards({ limit: 100 })
  const { data: dashboard } = useDashboard(selectedDashboardId ?? undefined)

  const dashboards = dashboardsData?.dashboards ?? []
  const panels: StatsPanel[] = (dashboard?.panels as StatsPanel[]) ?? []

  const filteredPanels = search
    ? panels.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.operation_type.toLowerCase().includes(search.toLowerCase())
      )
    : panels

  const handleInsert = (panel: StatsPanel) => {
    if (!editor) return
    editor
      .chain()
      .focus()
      .insertContent({
        type: "statsPanel",
        attrs: {
          panelId: panel.id,
          title: panel.name,
          panelType: panel.type,
        },
      })
      .run()
    setOpen(false)
    setSelectedDashboardId(null)
    setSearch("")
  }

  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="transparent" aria-label="Insert stats panel">
          <ChartBar /> Panel
        </Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Heading level="h2">Insert stats panel</Heading>
        </FocusModal.Header>
        <FocusModal.Body className="flex overflow-hidden">
          <div className="w-[280px] border-r overflow-y-auto">
            <div className="px-4 py-3 border-b">
              <Text size="xsmall" className="text-ui-fg-muted uppercase">
                Dashboards
              </Text>
            </div>
            <div className="divide-y">
              {dashboards.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDashboardId(d.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-ui-bg-subtle ${
                    selectedDashboardId === d.id ? "bg-ui-bg-subtle" : ""
                  }`}
                >
                  <Text size="small" weight="plus" className="truncate">
                    {d.name}
                  </Text>
                  {d.description && (
                    <Text size="xsmall" className="text-ui-fg-muted truncate">
                      {d.description}
                    </Text>
                  )}
                </button>
              ))}
              {dashboards.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    No dashboards yet. Create one at /stats first.
                  </Text>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {!selectedDashboardId ? (
              <div className="flex items-center justify-center h-full">
                <Text size="small" className="text-ui-fg-muted">
                  Select a dashboard to see its panels
                </Text>
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b sticky top-0 bg-ui-bg-base z-10">
                  <Input
                    size="small"
                    placeholder="Search panels…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 p-4">
                  {filteredPanels.map((panel) => (
                    <button
                      key={panel.id}
                      onClick={() => handleInsert(panel)}
                      className="border rounded-lg p-3 text-left hover:border-ui-border-interactive hover:bg-ui-bg-subtle transition"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Text size="small" weight="plus" className="truncate">
                          {panel.name}
                        </Text>
                        <Badge size="xsmall">{panel.type}</Badge>
                      </div>
                      <Text size="xsmall" className="text-ui-fg-muted truncate mt-1">
                        {panel.operation_type}
                      </Text>
                    </button>
                  ))}
                  {filteredPanels.length === 0 && (
                    <div className="col-span-2 text-center py-8">
                      <Text size="small" className="text-ui-fg-muted">
                        {panels.length === 0 ? "No panels in this dashboard." : "No matches."}
                      </Text>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
