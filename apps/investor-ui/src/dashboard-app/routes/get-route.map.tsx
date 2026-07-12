import { t } from "i18next"
import { RouteObject } from "react-router-dom"
import { ProtectedRoute } from "../../components/authentication/protected-route"
import { MainLayout } from "../../components/layout/main-layout"
import { PublicLayout } from "../../components/layout/public-layout"
import { SettingsLayout } from "../../components/layout/settings-layout"
import { ErrorBoundary } from "../../components/utilities/error-boundary"

// Investor UI — blanked shell.
// Cloned from @medusajs/dashboard v2.17.2 and stripped down to the framework,
// auth, layout, and settings plumbing. Domain routes (products, orders, etc.)
// were removed; investor-specific routes are added here incrementally.
export function getRouteMap({
  settingsRoutes,
  coreRoutes,
}: {
  settingsRoutes: RouteObject[]
  coreRoutes: RouteObject[]
}) {
  return [
    {
      element: <ProtectedRoute />,
      errorElement: <ErrorBoundary />,
      children: [
        {
          element: <MainLayout />,
          children: [
            {
              path: "/",
              errorElement: <ErrorBoundary />,
              lazy: () => import("../../routes/home"),
              children: [
                {
                  path: "onboarding",
                  errorElement: <ErrorBoundary />,
                  lazy: () => import("../../routes/onboarding"),
                },
              ],
            },
            {
              path: "/companies/:companyId",
              errorElement: <ErrorBoundary />,
              lazy: () => import("../../routes/companies/[companyId]"),
            },
            {
              path: "/company",
              errorElement: <ErrorBoundary />,
              lazy: () => import("../../routes/company"),
              children: [
                {
                  path: "invite",
                  lazy: () => import("../../routes/company/invite"),
                },
              ],
            },
            {
              path: "/cap-table",
              errorElement: <ErrorBoundary />,
              lazy: () => import("../../routes/cap-table"),
            },
            {
              path: "/finances",
              errorElement: <ErrorBoundary />,
              lazy: () => import("../../routes/finances"),
              children: [
                {
                  path: "participate/:dealId",
                  lazy: () => import("../../routes/finances/participate"),
                },
              ],
            },
            {
              path: "/compliance",
              errorElement: <ErrorBoundary />,
              lazy: () => import("../../routes/compliance"),
            },
            {
              path: "/projections",
              errorElement: <ErrorBoundary />,
              lazy: () => import("../../routes/projections"),
            },
            ...coreRoutes,
          ],
        },
      ],
    },
    {
      element: <ProtectedRoute />,
      errorElement: <ErrorBoundary />,
      children: [
        {
          path: "/settings",
          handle: {
            breadcrumb: () => t("app.nav.settings.header"),
          },
          element: <SettingsLayout />,
          children: [
            {
              index: true,
              errorElement: <ErrorBoundary />,
              lazy: () => import("../../routes/settings"),
            },
            {
              path: "profile",
              errorElement: <ErrorBoundary />,
              lazy: () => import("../../routes/profile/profile-detail"),
              children: [
                {
                  path: "edit",
                  lazy: () => import("../../routes/profile/profile-edit"),
                },
              ],
            },
            {
              path: "verification",
              errorElement: <ErrorBoundary />,
              lazy: () => import("../../routes/settings/verification"),
              children: [
                {
                  path: "edit",
                  lazy: () => import("../../routes/settings/verification/edit"),
                },
              ],
            },
            ...settingsRoutes.flatMap((r) => r?.children || []),
          ],
        },
      ],
    },
    {
      element: <PublicLayout />,
      children: [
        {
          errorElement: <ErrorBoundary />,
          children: [
            {
              path: "/login",
              lazy: () => import("../../routes/login"),
              handle: {
                breadcrumb: () => t("login.title"),
              },
            },
            {
              path: "/reset-password",
              lazy: () => import("../../routes/reset-password"),
              handle: {
                breadcrumb: () => t("resetPassword.title"),
              },
            },
            {
              path: "/invite",
              lazy: () => import("../../routes/invite"),
              handle: {
                breadcrumb: () => t("invite.title"),
              },
            },
            {
              path: "*",
              lazy: () => import("../../routes/no-match"),
            },
          ],
        },
      ],
    },
  ]
}
