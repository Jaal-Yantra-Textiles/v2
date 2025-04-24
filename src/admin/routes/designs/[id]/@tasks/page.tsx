// designs/[id]/tasks/page.tsx

import { Navigate, useParams } from "react-router-dom"

export default function TaskIndexPage() {
  const { id } = useParams()
  // Redirect to /metadata/edit or back to /persons/:id
  return <Navigate to={`/designs/${id}`} replace />
}
