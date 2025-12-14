import type { UIMatch } from "react-router-dom"
import { RouteObject } from "react-router-dom"

import { ProtectedRoute } from "../../components/authentication/protected-route"
import { MainLayout } from "../../components/layout/main-layout"
import { SettingsLayout } from "../../components/layout/settings-layout"
import { PublicLayout } from "../../components/layout/public-layout"
import { ErrorBoundary } from "../../components/utilities/error-boundary"

export function getPartnerRouteMap(): RouteObject[] {
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
              handle: {
                breadcrumb: () => "Home",
              },
              lazy: () => import("../../routes/home"),
            },
            {
              path: "/create-store",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Create store",
              },
              lazy: () => import("../../routes/home/home-create-store"),
            },
            {
              path: "/verification",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Verification",
              },
              lazy: () => import("../../routes/home/home-verification"),
            },
            {
              path: "/designs",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Designs",
              },
              children: [
                {
                  path: "",
                  lazy: () => import("../../routes/designs/design-list"),
                },
                {
                  path: ":id",
                  handle: {
                    breadcrumb: (match?: UIMatch) => match?.params?.id || "Design",
                  },
                  lazy: () => import("../../routes/designs/design-detail"),
                  children: [
                    {
                      path: "start",
                      lazy: () => import("../../routes/designs/design-start"),
                    },
                    {
                      path: "complete",
                      lazy: () => import("../../routes/designs/design-complete"),
                    },
                    {
                      path: "media",
                      lazy: () => import("../../routes/designs/design-media"),
                    },
                    {
                      path: "moodboard",
                      lazy: () => import("../../routes/designs/design-moodboard"),
                    },
                  ],
                },
              ],
            },
            {
              path: "/inventory-orders",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Inventory Orders",
              },
              children: [
                {
                  path: "",
                  lazy: () =>
                    import("../../routes/inventory-orders/inventory-orders-list"),
                },
                {
                  path: ":id",
                  handle: {
                    breadcrumb: (match?: UIMatch) =>
                      match?.params?.id || "Inventory Order",
                  },
                  lazy: () =>
                    import("../../routes/inventory-orders/inventory-order-detail"),
                  children: [
                    {
                      path: "start",
                      lazy: () =>
                        import(
                          "../../routes/inventory-orders/inventory-order-start"
                        ),
                    },
                    {
                      path: "complete",
                      lazy: () =>
                        import(
                          "../../routes/inventory-orders/inventory-order-complete"
                        ),
                    },
                  ],
                },
              ],
            },
            {
              path: "/tasks",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Tasks",
              },
              children: [
                {
                  path: "",
                  lazy: () => import("../../routes/tasks/task-list"),
                },
                {
                  path: ":id",
                  handle: {
                    breadcrumb: (match?: UIMatch) => match?.params?.id || "Task",
                  },
                  lazy: () => import("../../routes/tasks/task-detail"),
                  children: [
                    {
                      path: "accept",
                      lazy: () => import("../../routes/tasks/task-accept"),
                    },
                    {
                      path: "finish",
                      lazy: () => import("../../routes/tasks/task-finish"),
                    },
                  ],
                },
              ],
            },
            {
              path: "/profile",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Profile",
              },
              lazy: () => import("../../routes/profile-redirect"),
            },
          ],
        },
        {
          element: <SettingsLayout />,
          children: [
            {
              path: "/settings",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Settings",
              },
              lazy: () => import("../../routes/settings"),
              children: [
                {
                  path: "profile",
                  lazy: () => import("../../routes/profile/profile-detail"),
                },
                {
                  path: "store",
                  lazy: () => import("../../routes/settings/stores"),
                },
                {
                  path: "onboarding",
                  lazy: () => import("../../routes/settings/onboarding"),
                },
                {
                  path: "people",
                  lazy: () => import("../../routes/settings/people"),
                  children: [
                    {
                      path: "create",
                      lazy: () =>
                        import("../../routes/settings/people/people-create"),
                    },
                  ],
                },
                {
                  path: "payments",
                  lazy: () => import("../../routes/settings/payments"),
                  children: [
                    {
                      path: "create",
                      lazy: () =>
                        import("../../routes/settings/payments/payments-create"),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      element: <PublicLayout />,
      errorElement: <ErrorBoundary />,
      children: [
        {
          path: "/login",
          lazy: () => import("../../routes/login"),
        },
        {
          path: "/reset-password",
          lazy: () => import("../../routes/reset-password"),
        },
        {
          path: "/register",
          lazy: () => import("../../routes/register/index"),
        },
        {
          path: "/invite",
          lazy: () => import("../../routes/invite"),
        },
      ],
    },
    {
      path: "*",
      lazy: () => import("../../routes/no-match"),
    },
  ]
}
