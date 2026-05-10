import { Container, Heading, Text } from "@medusajs/ui"
import { useNavigate, UIMatch } from "react-router-dom"
import { GoalForm } from "../../../../components/ad-planning/goals/goal-form"

export default function CreateGoalPage() {
  const navigate = useNavigate()

  return (
    <Container className="p-0 divide-y">
      <div className="px-6 py-4">
        <Heading level="h2">Create goal</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Define a new conversion goal. After creation you can wire its
          Google Ads mapping from the detail page.
        </Text>
      </div>
      <GoalForm
        mode="create"
        onCancel={() => navigate("/ad-planning/goals")}
        onSuccess={(goalId) =>
          navigate(`/ad-planning/goals/${goalId}`, { replace: true })
        }
      />
    </Container>
  )
}

export const handle = {
  breadcrumb: () => "Create",
}
