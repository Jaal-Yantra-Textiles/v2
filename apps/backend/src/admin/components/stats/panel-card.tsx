import { Container, Heading, IconButton, toast, usePrompt } from "@medusajs/ui"
import { EllipsisHorizontal, PencilSquare, Trash, ArrowPath } from "@medusajs/icons"
import { ActionMenu } from "../common/action-menu"
import { StatsPanel, useDeletePanel, usePanelData } from "../../hooks/api/stats"
import { PanelRenderer } from "./panel-renderer"

type PanelCardProps = {
  panel: StatsPanel
  onEdit: (panel: StatsPanel) => void
}

export function PanelCard({ panel, onEdit }: PanelCardProps) {
  const prompt = usePrompt()
  const { data, isLoading, error, refetch, isFetching } = usePanelData(panel.id)
  const deletePanel = useDeletePanel(panel.dashboard_id)

  const handleDelete = async () => {
    const confirmed = await prompt({
      title: "Delete panel",
      description: `Delete "${panel.name}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    deletePanel.mutate(panel.id, {
      onSuccess: () => toast.success("Panel deleted"),
      onError: (e) => toast.error(`Failed: ${e.message}`),
    })
  }

  return (
    <Container className="p-0 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex flex-col min-w-0">
          <Heading level="h3" className="text-sm font-medium truncate">
            {panel.name}
          </Heading>
          <span className="text-ui-fg-muted text-xs">
            {panel.type} · {panel.operation_type}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            size="small"
            variant="transparent"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh"
          >
            <ArrowPath />
          </IconButton>
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: "Edit",
                    icon: <PencilSquare />,
                    onClick: () => onEdit(panel),
                  },
                ],
              },
              {
                actions: [
                  {
                    label: "Delete",
                    icon: <Trash />,
                    onClick: handleDelete,
                  },
                ],
              },
            ]}
          />
        </div>
      </div>
      <div className="flex-1 min-h-[120px]">
        <PanelRenderer
          panel={panel}
          result={data}
          isLoading={isLoading}
          error={error ? (error as Error).message : undefined}
        />
      </div>
    </Container>
  )
}
