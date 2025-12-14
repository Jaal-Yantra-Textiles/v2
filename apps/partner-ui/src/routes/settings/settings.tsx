import { Outlet, useLocation, Navigate } from "react-router-dom"

export const Settings = () => {
  const { pathname } = useLocation()

  if (pathname !== "/settings") {
    return <Outlet />
  }

  return <Navigate to="/settings/store" replace />
}
