import { Heading, Text, clx } from "@medusajs/ui"
import { CheckCircleSolid } from "@medusajs/icons"

const ActivityList = [
  {
    title: "Add your details",
    description: "Fill out your company profile and contact information.",
    isComplete: false, // This can be dynamic later
  },
  {
    title: "Add your people and their types",
    description: "Invite your team members and assign them roles.",
    isComplete: false,
  },
  {
    title: "Learn how to get tasks",
    description: "Understand the workflow and how to receive and manage tasks.",
    isComplete: false,
  },
]

const Setup = () => {
  return (
    <div className="flex w-full justify-center">
      <div className="w-full max-w-2xl rounded-lg border bg-ui-bg-base p-8">
        <div className="flex flex-col items-center gap-y-2">
          <Heading level="h2">You are new here, but let&apos;s get you started!</Heading>
          <Text className="text-ui-fg-subtle">
            Complete the following steps to get your account up and running.
          </Text>
        </div>
        <div className="mt-8">
          <ul className="flex flex-col gap-y-4">
            {ActivityList.map((activity, index) => (
              <li key={index} className="flex items-start gap-x-4">
                <div
                  className={clx(
                    "flex h-6 w-6 items-center justify-center rounded-full border text-sm",
                    {
                      "border-ui-border-strong bg-ui-bg-base": !activity.isComplete,
                      "border-green-500 bg-green-400 text-white": activity.isComplete,
                    }
                  )}
                >
                  {activity.isComplete ? <CheckCircleSolid /> : index + 1}
                </div>
                <div>
                  <Text weight="plus" size="large" className="text-ui-fg-base">
                    {activity.title}
                  </Text>
                  <Text className="text-ui-fg-subtle">{activity.description}</Text>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

export default Setup
