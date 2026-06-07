import { useParams } from "react-router-dom"

import { useDesign } from "../../../../hooks/api/designs"
import { DesignTasksSection } from "../../../../components/designs/design-tasks-section"
import { SingleColumnPageSkeleton } from "../../../../components/table/skeleton"

/**
 * Dedicated tasks sub-page for a design (roadmap #8). The detail page
 * shows a compact summary card; "View all" links here for the full task
 * list + management. Reuses the existing DesignTasksSection. The task
 * create/edit modals continue to live under the @tasks routes. Breadcrumb
 * via the route handle.
 */
export default function DesignTasksPage() {
  const { id } = useParams()
  const { design, isLoading } = useDesign(id!, {
    fields: [
      "tasks.*",
      "tasks.subtasks.*",
      "tasks.outgoing.*",
      "tasks.incoming.*",
    ],
  })

  if (isLoading || !design) {
    return <SingleColumnPageSkeleton sections={1} />
  }

  return (
    <div className="flex w-full flex-col gap-y-3">
      <DesignTasksSection design={design} />
    </div>
  )
}

export const handle = {
  breadcrumb: () => "Tasks",
}
