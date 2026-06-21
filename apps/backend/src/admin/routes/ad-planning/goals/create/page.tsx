import { Heading, Text } from "@medusajs/ui"
import { useNavigate } from "react-router-dom"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { GoalForm } from "../../../../components/ad-planning/goals/goal-form"

export default function CreateGoalPage() {
  const navigate = useNavigate()

  return (
    <RouteFocusModal prev="/ad-planning/goals">
      <RouteFocusModal.Header>
        <div className="flex flex-col">
          <RouteFocusModal.Title asChild>
            <Heading>Create goal</Heading>
          </RouteFocusModal.Title>
          <RouteFocusModal.Description asChild>
            <Text size="small" className="text-ui-fg-subtle">
              Define a new conversion goal. After creation you can wire its
              Google Ads mapping from the detail page.
            </Text>
          </RouteFocusModal.Description>
        </div>
      </RouteFocusModal.Header>
      <GoalForm
        mode="create"
        bodyClassName="flex flex-1 flex-col gap-y-5 overflow-y-auto px-6 py-6 mx-auto w-full max-w-2xl"
        footerClassName="px-6 py-3 border-t border-ui-border-base"
        onCancel={() => navigate("/ad-planning/goals")}
        onSuccess={(goalId) =>
          navigate(`/ad-planning/goals/${goalId}`, { replace: true })
        }
      />
    </RouteFocusModal>
  )
}

export const handle = {
  breadcrumb: () => "Create",
}
