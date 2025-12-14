import { Navigate } from "react-router-dom"

export const ProfileRedirect = () => {
  return <Navigate to="/settings/profile" replace />
}
