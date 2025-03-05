// persons/[id]/metadata/page.tsx

import { Navigate, useParams } from "react-router-dom"

export default function MetadataIndexPage() {
  const { id } = useParams()
  // Redirect to /metadata/edit or back to /persons/:id
  return <Navigate to={`/settings/task-templates/${id}`} replace />
}
