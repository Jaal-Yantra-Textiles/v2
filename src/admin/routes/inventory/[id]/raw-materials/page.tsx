// persons/[id]/metadata/page.tsx

import { Navigate, useParams } from "react-router-dom"

export default function RawMaterialIndexPage() {
  const { id } = useParams()
  // Redirect to /metadata/edit or back to /persons/:id
  return <Navigate to={`/inventory/${id}`} replace />
}
