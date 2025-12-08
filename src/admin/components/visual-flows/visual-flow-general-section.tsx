import { PencilSquare, Trash, PlaySolid } from "@medusajs/icons"
import {
  Container,
  Heading,
  StatusBadge,
  Text,
  toast,
  usePrompt,
  Badge,
} from "@medusajs/ui"
import { useNavigate } from "react-router-dom"
import { ActionMenu } from "../common/action-menu"
import { VisualFlow, useDeleteVisualFlow, useExecuteVisualFlow, useUpdateVisualFlow } from "../../hooks/api/visual-flows"

const getStatusBadgeColor = (status: string): "green" | "orange" | "grey" => {
  switch (status) {
    case "active":
      return "green"
    case "inactive":
      return "grey"
    case "draft":
      return "orange"
    default:
      return "grey"
  }
}

const getTriggerLabel = (triggerType: string): string => {
  const labels: Record<string, string> = {
    event: "Event Trigger",
    schedule: "Scheduled",
    webhook: "Webhook",
    manual: "Manual",
    another_flow: "Flow Trigger",
  }
  return labels[triggerType] || triggerType
}

interface VisualFlowGeneralSectionProps {
  flow: VisualFlow
}

export const VisualFlowGeneralSection = ({ flow }: VisualFlowGeneralSectionProps) => {
  const prompt = usePrompt()
  const navigate = useNavigate()
  const { mutateAsync: deleteFlow } = useDeleteVisualFlow()
  const { mutateAsync: executeFlow, isPending: isExecuting } = useExecuteVisualFlow(flow.id)
  const { mutateAsync: updateFlow } = useUpdateVisualFlow(flow.id)

  const handleDelete = async () => {
    const res = await prompt({
      title: "Delete Flow",
      description: `Are you sure you want to delete "${flow.name}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
    })

    if (!res) {
      return
    }

    await deleteFlow(flow.id, {
      onSuccess: () => {
        toast.success("Flow deleted successfully")
        navigate("/visual-flows", { replace: true })
      },
      onError: (error) => {
        toast.error(error.message)
      },
    })
  }

  const handleExecute = async () => {
    await executeFlow(
      {},
      {
        onSuccess: (result) => {
          if (result.status === "completed") {
            toast.success("Flow executed successfully")
          } else if (result.status === "failed") {
            toast.error(`Flow execution failed: ${result.error}`)
          } else {
            toast.info("Flow execution started")
          }
        },
        onError: (error) => {
          toast.error(`Failed to execute flow: ${error.message}`)
        },
      }
    )
  }

  const handleToggleStatus = async () => {
    const newStatus = flow.status === "active" ? "inactive" : "active"
    await updateFlow(
      { status: newStatus },
      {
        onSuccess: () => {
          toast.success(`Flow ${newStatus === "active" ? "activated" : "deactivated"}`)
        },
        onError: (error) => {
          toast.error(error.message)
        },
      }
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading>{flow.name}</Heading>
        </div>
        <div className="flex items-center gap-x-4">
          <StatusBadge color={getStatusBadgeColor(flow.status)}>
            {flow.status.charAt(0).toUpperCase() + flow.status.slice(1)}
          </StatusBadge>
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: "Edit",
                    icon: <PencilSquare />,
                    to: "edit",
                  },
                  {
                    label: "Execute",
                    icon: <PlaySolid />,
                    onClick: handleExecute,
                    disabled: flow.status !== "active" || isExecuting,
                  },
                ],
              },
              {
                actions: [
                  {
                    label: flow.status === "active" ? "Deactivate" : "Activate",
                    icon: <PlaySolid />,
                    onClick: handleToggleStatus,
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

      <div className="pt-4">
        <div className="divide-y">
          {/* Description */}
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              Description
            </Text>
            <Text size="small" leading="compact">
              {flow.description || "-"}
            </Text>
          </div>

          {/* Trigger Type */}
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              Trigger Type
            </Text>
            <Badge color="blue">{getTriggerLabel(flow.trigger_type)}</Badge>
          </div>

          {/* Operations Count */}
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              Operations
            </Text>
            <Text size="small" leading="compact">
              {flow.operations?.length || 0} operations
            </Text>
          </div>

          {/* Created At */}
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              Created
            </Text>
            <Text size="small" leading="compact">
              {new Date(flow.created_at).toLocaleString()}
            </Text>
          </div>

          {/* Updated At */}
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              Last Updated
            </Text>
            <Text size="small" leading="compact">
              {new Date(flow.updated_at).toLocaleString()}
            </Text>
          </div>
        </div>
      </div>
    </Container>
  )
}
