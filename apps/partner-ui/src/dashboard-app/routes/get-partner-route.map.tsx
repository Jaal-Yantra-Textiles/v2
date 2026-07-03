import { HttpTypes } from "@medusajs/types"
import type { UIMatch } from "react-router-dom"
import { Navigate, Outlet, RouteObject } from "react-router-dom"

import { ProtectedRoute } from "../../components/authentication/protected-route"
import { MainLayout } from "../../components/layout/main-layout"
import { SettingsLayout } from "../../components/layout/settings-layout"
import { PublicLayout } from "../../components/layout/public-layout"
import { ErrorBoundary } from "../../components/utilities/error-boundary"
import { TaxRegionDetailBreadcrumb } from "../../routes/tax-regions/tax-region-detail/breadcrumb"
import { taxRegionLoader } from "../../routes/tax-regions/tax-region-detail/loader"

// #826 — media / moodboard UPLOAD children for the in-order design-details
// sub-route. Shared by both the legacy single-design `design-details` route and
// the per-design `design-details/:designId` route (collated orders). The upload
// components resolve the design id via useResolvedDesignId (prefers :designId).
const designDetailsChildren: RouteObject[] = [
  {
    path: "media",
    lazy: () => import("../../routes/designs/design-media"),
  },
  {
    path: "media-preview",
    lazy: () => import("../../routes/designs/design-media-preview"),
  },
  {
    path: "moodboard",
    lazy: () => import("../../routes/designs/design-moodboard"),
  },
]

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
              children: [
                {
                  path: "onboarding",
                  lazy: () =>
                    import("../../routes/home/home-onboarding"),
                },
              ],
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
                  // Roadmap #6 Phase 1 — partner creates a design
                  path: "create",
                  lazy: () => import("../../routes/designs/design-create"),
                },
                {
                  path: ":id",
                  handle: {
                    breadcrumb: (match?: UIMatch) => match?.params?.id || "Design",
                  },
                  lazy: () => import("../../routes/designs/design-detail"),
                  children: [
                    {
                      // Phase 1 — edit own design
                      path: "edit",
                      lazy: () => import("../../routes/designs/design-edit"),
                    },
                    {
                      // Phase 2 — add inventory (BOM) to own design
                      path: "add-inventory",
                      lazy: () => import("../../routes/designs/design-add-inventory"),
                    },
                    {
                      // Phase 4 — partner starts a production run
                      path: "production-run-create",
                      lazy: () =>
                        import("../../routes/designs/design-production-run-create"),
                    },
                    {
                      path: "media-preview",
                      lazy: () => import("../../routes/designs/design-media-preview"),
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
              path: "/shared-folders",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Shared Folders",
              },
              children: [
                {
                  path: "",
                  lazy: () =>
                    import(
                      "../../routes/shared-folders/shared-folder-list/shared-folder-list"
                    ),
                },
                {
                  path: ":id",
                  handle: {
                    breadcrumb: (match?: UIMatch) =>
                      match?.params?.id || "Folder",
                  },
                  lazy: () =>
                    import(
                      "../../routes/shared-folders/shared-folder-detail/shared-folder-detail"
                    ),
                  children: [
                    {
                      path: "media/:mediaId",
                      lazy: () =>
                        import(
                          "../../routes/shared-folders/shared-folder-media-detail/shared-folder-media-detail"
                        ),
                    },
                  ],
                },
              ],
            },
            {
              path: "/payment-submissions",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Payment Submissions",
              },
              children: [
                {
                  path: "",
                  lazy: () =>
                    import(
                      "../../routes/payment-submissions/payment-submission-list/payment-submission-list"
                    ),
                },
                {
                  path: "create",
                  lazy: () =>
                    import(
                      "../../routes/payment-submissions/payment-submission-create/payment-submission-create"
                    ),
                },
                {
                  path: ":id",
                  lazy: () =>
                    import(
                      "../../routes/payment-submissions/payment-submission-detail/payment-submission-detail"
                    ),
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
                  // #342 — retired: the inventory work-order LIST is gone; the
                  // unified `/orders/inventory` panel is the surface. Redirect
                  // the legacy list path so bookmarks/links keep resolving.
                  path: "",
                  element: <Navigate to="/orders/inventory" replace />,
                },
                {
                  // #342 — retired: inventory work-orders now live on the
                  // unified order detail. Redirect legacy detail links to
                  // /orders/:id (resolves the unified order id from the link).
                  path: ":id",
                  lazy: () =>
                    import(
                      "../../routes/inventory-orders/inventory-order-redirect"
                    ),
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
                      path: "subtasks/:subtaskId",
                      lazy: () => import("../../routes/tasks/task-subtask"),
                    },
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
              path: "/production-runs",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Production Runs",
              },
              children: [
                {
                  // #342 — retired: the design work-order LIST is the unified
                  // `/orders/design` panel now. Redirect the legacy list path.
                  path: "",
                  element: <Navigate to="/orders/design" replace />,
                },
                {
                  // #342 — retired: design work-orders open on the unified order
                  // detail (`/orders/:id`). Resolve the legacy run to its unified
                  // order and redirect; bookmarks/links keep working.
                  path: ":id",
                  lazy: () =>
                    import(
                      "../../routes/production-runs/production-run-redirect"
                    ),
                },
              ],
            },
            // Products
            {
              path: "/products",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Products",
              },
              children: [
                {
                  path: "",
                  lazy: () => import("../../routes/products/product-list"),
                },
                {
                  path: "create",
                  lazy: () =>
                    import("../../routes/products/product-create-choice"),
                },
                {
                  path: "create/quick",
                  lazy: () =>
                    import("../../routes/products/product-quick-create"),
                },
                {
                  path: "create/advanced",
                  lazy: () => import("../../routes/products/product-create"),
                },
                {
                  path: "import",
                  lazy: () => import("../../routes/products/product-import"),
                },
                {
                  path: "export",
                  lazy: () => import("../../routes/products/product-export"),
                },
                {
                  path: "inventory",
                  errorElement: <ErrorBoundary />,
                  handle: {
                    breadcrumb: () => "Stock",
                  },
                  children: [
                    {
                      path: "",
                      lazy: () =>
                        import("../../routes/inventory/inventory-list"),
                      children: [
                        {
                          path: "create",
                          lazy: () =>
                            import("../../routes/inventory/inventory-create"),
                        },
                      ],
                    },
                    {
                      path: ":id",
                      lazy: async () => {
                        const { Component, Breadcrumb, loader } = await import(
                          "../../routes/inventory/inventory-detail"
                        )
                        return {
                          Component,
                          loader,
                          handle: {
                            breadcrumb: (match: UIMatch) =>
                              <Breadcrumb {...match} />,
                          },
                        }
                      },
                      children: [
                        {
                          path: "edit",
                          lazy: () =>
                            import(
                              "../../routes/inventory/inventory-detail/components/edit-inventory-item"
                            ),
                        },
                        {
                          path: "attributes",
                          lazy: () =>
                            import(
                              "../../routes/inventory/inventory-detail/components/edit-inventory-item-attributes"
                            ),
                        },
                        {
                          path: "locations",
                          lazy: () =>
                            import(
                              "../../routes/inventory/inventory-detail/components/manage-locations"
                            ),
                        },
                        {
                          // Edit a single location level — drawer reads
                          // { id, location_id } from useParams(), so this
                          // nested path is the one the edit-action in
                          // location-levels-table/use-location-list-table-columns.tsx
                          // navigates to via `locations/${level.location_id}`.
                          path: "locations/:location_id",
                          lazy: () =>
                            import(
                              "../../routes/inventory/inventory-detail/components/adjust-inventory"
                            ),
                        },
                        {
                          path: "adjust",
                          lazy: () =>
                            import(
                              "../../routes/inventory/inventory-detail/components/adjust-inventory"
                            ),
                        },
                        {
                          path: "metadata/edit",
                          lazy: () =>
                            import(
                              "../../routes/inventory/inventory-metadata"
                            ),
                        },
                      ],
                    },
                  ],
                },
                {
                  path: ":id",
                  errorElement: <ErrorBoundary />,
                  lazy: async () => {
                    const { Breadcrumb, loader } = await import(
                      "../../routes/products/product-detail"
                    )
                    return {
                      Component: Outlet,
                      loader,
                      handle: {
                        breadcrumb: (
                          match: UIMatch<HttpTypes.AdminProductResponse>
                        ) => <Breadcrumb {...match} />,
                      },
                    }
                  },
                  children: [
                    {
                      path: "",
                      lazy: () =>
                        import("../../routes/products/product-detail"),
                      children: [
                        {
                          path: "edit",
                          lazy: () =>
                            import("../../routes/products/product-edit"),
                        },
                        {
                          path: "sales-channels",
                          lazy: () =>
                            import(
                              "../../routes/products/product-sales-channels"
                            ),
                        },
                        {
                          path: "media",
                          lazy: () =>
                            import("../../routes/products/product-media"),
                        },
                        {
                          path: "attributes",
                          lazy: () =>
                            import("../../routes/products/product-attributes"),
                        },
                        {
                          path: "organization",
                          lazy: () =>
                            import(
                              "../../routes/products/product-organization"
                            ),
                        },
                        {
                          path: "prices",
                          lazy: () =>
                            import("../../routes/products/product-prices"),
                        },
                        {
                          path: "stock",
                          lazy: () =>
                            import("../../routes/products/product-stock"),
                        },
                        {
                          path: "shipping-profile",
                          lazy: () =>
                            import(
                              "../../routes/products/product-shipping-profile"
                            ),
                        },
                        {
                          path: "metadata/edit",
                          lazy: () =>
                            import("../../routes/products/product-metadata"),
                        },
                        {
                          path: "options/create",
                          lazy: () =>
                            import(
                              "../../routes/products/product-create-option"
                            ),
                        },
                        {
                          path: "options/:optionId/edit",
                          lazy: () =>
                            import(
                              "../../routes/products/product-edit-option"
                            ),
                        },
                        {
                          path: "variants/create",
                          lazy: () =>
                            import(
                              "../../routes/products/product-create-variant"
                            ),
                        },
                        {
                          path: "edit-variant",
                          lazy: () =>
                            import(
                              "../../routes/product-variants/product-variant-edit"
                            ),
                        },
                        {
                          path: "images/:imageId/variants-edit",
                          lazy: () =>
                            import(
                              "../../routes/products/product-image-variants-edit"
                            ),
                        },
                      ],
                    },
                    {
                      path: "variants/:variant_id",
                      lazy: async () => {
                        const { Component, Breadcrumb, loader } = await import(
                          "../../routes/product-variants/product-variant-detail"
                        )

                        return {
                          Component,
                          loader,
                          handle: {
                            breadcrumb: (
                              match: UIMatch<HttpTypes.AdminProductVariantResponse>
                            ) => <Breadcrumb {...match} />,
                          },
                        }
                      },
                      children: [
                        {
                          path: "edit",
                          lazy: () =>
                            import(
                              "../../routes/product-variants/product-variant-edit"
                            ),
                        },
                        {
                          path: "media",
                          lazy: () =>
                            import(
                              "../../routes/product-variants/product-variant-media"
                            ),
                        },
                        {
                          path: "prices",
                          lazy: () =>
                            import("../../routes/products/product-prices"),
                        },
                        {
                          path: "manage-items",
                          lazy: () =>
                            import(
                              "../../routes/product-variants/product-variant-manage-inventory-items"
                            ),
                        },
                        {
                          path: "metadata/edit",
                          lazy: () =>
                            import(
                              "../../routes/product-variants/product-variant-metadata"
                            ),
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            // Orders
            {
              path: "/orders",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Orders",
              },
              children: [
                {
                  path: "",
                  lazy: () => import("../../routes/orders/order-list"),
                },
                // #342 Chunk 5 (T3.4): unified-panel kind sub-routes. Static
                // segments rank above `:id`, so an order id never collides.
                // Each renders the SAME kind-parameterized order-list (it reads
                // the kind off the path).
                {
                  path: "design",
                  lazy: () => import("../../routes/orders/order-list"),
                  handle: { breadcrumb: () => "Design" },
                },
                {
                  path: "inventory",
                  lazy: () => import("../../routes/orders/order-list"),
                  handle: { breadcrumb: () => "Inventory" },
                },
                {
                  path: "all",
                  lazy: () => import("../../routes/orders/order-list"),
                  handle: { breadcrumb: () => "All" },
                },
                {
                  path: ":id",
                  handle: {
                    breadcrumb: (match?: UIMatch) =>
                      match?.params?.id || "Order",
                  },
                  lazy: () => import("../../routes/orders/order-detail"),
                  children: [
                    {
                      path: "fulfillment",
                      lazy: () =>
                        import(
                          "../../routes/orders/order-create-fulfillment"
                        ),
                    },
                    {
                      path: "shipment/:fulfillmentId",
                      lazy: () =>
                        import("../../routes/orders/order-create-shipment"),
                    },
                    {
                      path: "returns",
                      lazy: () =>
                        import("../../routes/orders/order-create-return"),
                    },
                    {
                      path: "refund",
                      lazy: () =>
                        import("../../routes/orders/order-create-refund"),
                    },
                    {
                      path: "edit-email",
                      lazy: () =>
                        import("../../routes/orders/order-edit-email"),
                    },
                    {
                      path: "edit-shipping-address",
                      lazy: () =>
                        import(
                          "../../routes/orders/order-edit-shipping-address"
                        ),
                    },
                    {
                      path: "edit-billing-address",
                      lazy: () =>
                        import(
                          "../../routes/orders/order-edit-billing-address"
                        ),
                    },
                    {
                      path: "metadata/edit",
                      lazy: () =>
                        import("../../routes/orders/order-metadata"),
                    },
                    // #342 — design details as a sub-route of the order (breadcrumb
                    // Orders › <id> › Design details), keeping the partner in the
                    // Orders context instead of jumping to /designs/:id.
                    {
                      path: "design-details",
                      lazy: () =>
                        import("../../routes/orders/order-design-details"),
                      handle: { breadcrumb: () => "Design details" },
                      children: designDetailsChildren,
                    },
                    // #826 — per-design details for a COLLATED order (many
                    // designs on one order). `:designId` selects WHICH design;
                    // OrderDesignDetails resolves it directly instead of via the
                    // order's single legacy_id run pointer.
                    {
                      path: "design-details/:designId",
                      lazy: () =>
                        import("../../routes/orders/order-design-details"),
                      handle: { breadcrumb: () => "Design details" },
                      children: designDetailsChildren,
                    },
                    // #342 — inventory work-order actions folded onto the
                    // unified order detail. Nested under `inventory/` to avoid
                    // colliding with retail order sub-routes. The action
                    // components resolve the legacy inventory_order id from the
                    // unified order's metadata.legacy_id.
                    {
                      path: "inventory/start",
                      lazy: () =>
                        import(
                          "../../routes/inventory-orders/inventory-order-start"
                        ),
                    },
                    {
                      path: "inventory/complete",
                      lazy: () =>
                        import(
                          "../../routes/inventory-orders/inventory-order-complete"
                        ),
                    },
                    {
                      path: "inventory/submit-payment",
                      lazy: () =>
                        import(
                          "../../routes/inventory-orders/inventory-order-submit-payment"
                        ),
                    },
                    {
                      path: "inventory/ready-for-delivery",
                      lazy: () =>
                        import(
                          "../../routes/inventory-orders/inventory-order-ready-for-delivery"
                        ),
                    },
                    {
                      path: "inventory/create-shipment",
                      lazy: () =>
                        import(
                          "../../routes/inventory-orders/inventory-order-create-shipment"
                        ),
                    },
                    // #342 — design work-order task detail, folded onto the
                    // unified order detail (was `/production-runs/:id/tasks/:task_id`).
                    // Standalone partner tasks (not tied to a run) keep their own
                    // top-level `/tasks` surface — only run-tied tasks live here.
                    {
                      path: "tasks/:task_id",
                      lazy: () =>
                        import(
                          "../../components/work-orders/production-run-task-drawer"
                        ),
                    },
                  ],
                },
              ],
            },
            // Customers
            {
              path: "/customers",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Customers",
              },
              children: [
                {
                  path: "",
                  lazy: () => import("../../routes/customers/customer-list"),
                },
                {
                  path: "create",
                  lazy: () =>
                    import("../../routes/customers/customer-create"),
                },
                {
                  path: ":id",
                  handle: {
                    breadcrumb: (match?: UIMatch) =>
                      match?.params?.id || "Customer",
                  },
                  lazy: () =>
                    import("../../routes/customers/customer-detail"),
                  children: [
                    {
                      path: "edit",
                      lazy: () =>
                        import("../../routes/customers/customer-edit"),
                    },
                    {
                      path: "metadata/edit",
                      lazy: () =>
                        import("../../routes/customers/customer-metadata"),
                    },
                  ],
                },
              ],
            },
            // Categories
            {
              path: "/categories",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Categories",
              },
              children: [
                {
                  path: "",
                  lazy: () =>
                    import("../../routes/categories/category-list"),
                },
                {
                  path: "create",
                  lazy: () =>
                    import("../../routes/categories/category-create"),
                },
                {
                  path: ":id",
                  handle: {
                    breadcrumb: (match?: UIMatch) =>
                      match?.params?.id || "Category",
                  },
                  lazy: () =>
                    import("../../routes/categories/category-detail"),
                  children: [
                    {
                      path: "edit",
                      lazy: () =>
                        import("../../routes/categories/category-edit"),
                    },
                    {
                      path: "products",
                      lazy: () =>
                        import("../../routes/categories/category-products"),
                    },
                    {
                      path: "organize",
                      lazy: () =>
                        import("../../routes/categories/category-organize"),
                    },
                    {
                      path: "metadata/edit",
                      lazy: () =>
                        import("../../routes/categories/categories-metadata"),
                    },
                  ],
                },
              ],
            },
            // Collections
            {
              path: "/collections",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Collections",
              },
              children: [
                {
                  path: "",
                  lazy: () =>
                    import("../../routes/collections/collection-list"),
                },
                {
                  path: "create",
                  lazy: () =>
                    import("../../routes/collections/collection-create"),
                },
                {
                  path: ":id",
                  handle: {
                    breadcrumb: (match?: UIMatch) =>
                      match?.params?.id || "Collection",
                  },
                  lazy: () =>
                    import("../../routes/collections/collection-detail"),
                  children: [
                    {
                      path: "edit",
                      lazy: () =>
                        import("../../routes/collections/collection-edit"),
                    },
                    {
                      path: "add-products",
                      lazy: () =>
                        import(
                          "../../routes/collections/collection-add-products"
                        ),
                    },
                    {
                      path: "metadata/edit",
                      lazy: () =>
                        import(
                          "../../routes/collections/collection-metadata"
                        ),
                    },
                  ],
                },
              ],
            },
            // Product Types
            {
              path: "/product-types",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Product Types",
              },
              children: [
                {
                  path: "",
                  lazy: () =>
                    import(
                      "../../routes/product-types/product-type-list"
                    ),
                },
                {
                  path: "create",
                  lazy: () =>
                    import(
                      "../../routes/product-types/product-type-create"
                    ),
                },
                {
                  path: ":id",
                  handle: {
                    breadcrumb: (match?: UIMatch) =>
                      match?.params?.id || "Product Type",
                  },
                  lazy: () =>
                    import(
                      "../../routes/product-types/product-type-detail"
                    ),
                  children: [
                    {
                      path: "edit",
                      lazy: () =>
                        import(
                          "../../routes/product-types/product-type-edit"
                        ),
                    },
                    {
                      path: "metadata/edit",
                      lazy: () =>
                        import(
                          "../../routes/product-types/product-type-metadata"
                        ),
                    },
                  ],
                },
              ],
            },
            {
              path: "/content",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Content",
              },
              lazy: () =>
                import("../../routes/content/content-list"),
              children: [
                {
                  path: ":id",
                  lazy: () =>
                    import("../../routes/content/content-detail"),
                  handle: {
                    breadcrumb: () => "Edit Page",
                  },
                },
              ],
            },
            {
              path: "/webstore/theme",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Theme",
              },
              lazy: () => import("../../routes/settings/theme"),
            },
            {
              path: "/webstore/analytics",
              errorElement: <ErrorBoundary />,
              handle: {
                breadcrumb: () => "Analytics",
              },
              lazy: () => import("../../routes/webstore/analytics"),
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
                  children: [
                    {
                      path: "edit",
                      lazy: () => import("../../routes/profile/profile-edit"),
                    },
                  ],
                },
                {
                  path: "store",
                  lazy: () => import("../../routes/settings/stores"),
                  children: [
                    {
                      path: "edit",
                      lazy: () => import("../../routes/settings/stores/store-edit"),
                    },
                  ],
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
                {
                  path: "plan",
                  lazy: () => import("../../routes/settings/plan"),
                },
                // Regions
                {
                  path: "regions",
                  errorElement: <ErrorBoundary />,
                  element: <Outlet />,
                  handle: {
                    breadcrumb: () => "Regions",
                  },
                  children: [
                    {
                      path: "",
                      lazy: () => import("../../routes/regions/region-list"),
                      children: [
                        {
                          path: "create",
                          lazy: () => import("../../routes/regions/region-create"),
                        },
                      ],
                    },
                    {
                      path: ":id",
                      lazy: async () => {
                        const { Component, Breadcrumb, loader } = await import(
                          "../../routes/regions/region-detail"
                        )
                        return {
                          Component,
                          loader,
                          handle: {
                            breadcrumb: (match: UIMatch<HttpTypes.AdminRegionResponse>) =>
                              <Breadcrumb {...match} />,
                          },
                        }
                      },
                      children: [
                        {
                          path: "edit",
                          lazy: () => import("../../routes/regions/region-edit"),
                        },
                        {
                          path: "countries/add",
                          lazy: () => import("../../routes/regions/region-add-countries"),
                        },
                        {
                          path: "metadata/edit",
                          lazy: () => import("../../routes/regions/region-metadata"),
                        },
                      ],
                    },
                  ],
                },
                // Locations & Shipping
                {
                  path: "locations",
                  errorElement: <ErrorBoundary />,
                  element: <Outlet />,
                  handle: {
                    breadcrumb: () => "Locations & Shipping",
                  },
                  children: [
                    {
                      path: "",
                      lazy: () => import("../../routes/locations/location-list"),
                    },
                    {
                      path: "create",
                      lazy: () => import("../../routes/locations/location-create"),
                    },
                    {
                      path: "shipping-profiles",
                      element: <Outlet />,
                      handle: {
                        breadcrumb: () => "Shipping Profiles",
                      },
                      children: [
                        {
                          path: "",
                          lazy: () =>
                            import("../../routes/shipping-profiles/shipping-profiles-list"),
                          children: [
                            {
                              path: "create",
                              lazy: () =>
                                import("../../routes/shipping-profiles/shipping-profile-create"),
                            },
                          ],
                        },
                        {
                          path: ":shipping_profile_id",
                          lazy: async () => {
                            const { Component, Breadcrumb, loader } = await import(
                              "../../routes/shipping-profiles/shipping-profile-detail"
                            )
                            return {
                              Component,
                              loader,
                              handle: {
                                breadcrumb: (
                                  match: UIMatch<HttpTypes.AdminShippingProfileResponse>
                                ) => <Breadcrumb {...match} />,
                              },
                            }
                          },
                          children: [
                            {
                              path: "metadata/edit",
                              lazy: () =>
                                import("../../routes/shipping-profiles/shipping-profile-metadata"),
                            },
                          ],
                        },
                      ],
                    },
                    {
                      path: "shipping-option-types",
                      errorElement: <ErrorBoundary />,
                      element: <Outlet />,
                      handle: {
                        breadcrumb: () => "Shipping Option Types",
                      },
                      children: [
                        {
                          path: "",
                          lazy: () =>
                            import("../../routes/shipping-option-types/shipping-option-type-list"),
                          children: [
                            {
                              path: "create",
                              lazy: () =>
                                import("../../routes/shipping-option-types/shipping-option-type-create"),
                            },
                          ],
                        },
                        {
                          path: ":id",
                          lazy: async () => {
                            const { Component, Breadcrumb, loader } = await import(
                              "../../routes/shipping-option-types/shipping-option-type-detail"
                            )
                            return {
                              Component,
                              loader,
                              handle: {
                                breadcrumb: (
                                  match: UIMatch<HttpTypes.AdminShippingOptionTypeResponse>
                                ) => <Breadcrumb {...match} />,
                              },
                            }
                          },
                          children: [
                            {
                              path: "edit",
                              lazy: () =>
                                import("../../routes/shipping-option-types/shipping-option-type-edit"),
                            },
                          ],
                        },
                      ],
                    },
                    {
                      path: ":location_id",
                      lazy: async () => {
                        const { Component, Breadcrumb, loader } = await import(
                          "../../routes/locations/location-detail"
                        )
                        return {
                          Component,
                          loader,
                          handle: {
                            breadcrumb: (match: UIMatch<HttpTypes.AdminStockLocationResponse>) =>
                              <Breadcrumb {...match} />,
                          },
                        }
                      },
                      children: [
                        {
                          path: "edit",
                          lazy: () => import("../../routes/locations/location-edit"),
                        },
                        {
                          path: "sales-channels",
                          lazy: () => import("../../routes/locations/location-sales-channels"),
                        },
                        {
                          path: "fulfillment-providers",
                          lazy: () =>
                            import("../../routes/locations/location-fulfillment-providers"),
                        },
                        {
                          path: "fulfillment-set/:fset_id",
                          children: [
                            {
                              path: "service-zones/create",
                              lazy: () =>
                                import("../../routes/locations/location-service-zone-create"),
                            },
                            {
                              path: "service-zone/:zone_id",
                              children: [
                                {
                                  path: "edit",
                                  lazy: () =>
                                    import("../../routes/locations/location-service-zone-edit"),
                                },
                                {
                                  path: "areas",
                                  lazy: () =>
                                    import("../../routes/locations/location-service-zone-manage-areas"),
                                },
                                {
                                  path: "shipping-option",
                                  children: [
                                    {
                                      path: "create",
                                      lazy: () =>
                                        import("../../routes/locations/location-service-zone-shipping-option-create"),
                                    },
                                    {
                                      path: ":so_id",
                                      children: [
                                        {
                                          path: "edit",
                                          lazy: () =>
                                            import("../../routes/locations/location-service-zone-shipping-option-edit"),
                                        },
                                        {
                                          path: "pricing",
                                          lazy: () =>
                                            import("../../routes/locations/location-service-zone-shipping-option-pricing"),
                                        },
                                      ],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                // Sales Channels
                {
                  path: "sales-channels",
                  errorElement: <ErrorBoundary />,
                  element: <Outlet />,
                  handle: {
                    breadcrumb: () => "Sales Channels",
                  },
                  children: [
                    {
                      path: "",
                      lazy: () => import("../../routes/sales-channels/sales-channel-list"),
                      children: [
                        {
                          path: "create",
                          lazy: () => import("../../routes/sales-channels/sales-channel-create"),
                        },
                      ],
                    },
                    {
                      path: ":id",
                      lazy: async () => {
                        const { Component, Breadcrumb, loader } = await import(
                          "../../routes/sales-channels/sales-channel-detail"
                        )
                        return {
                          Component,
                          loader,
                          handle: {
                            breadcrumb: (match: UIMatch<HttpTypes.AdminSalesChannelResponse>) =>
                              <Breadcrumb {...match} />,
                          },
                        }
                      },
                      children: [
                        {
                          path: "edit",
                          lazy: () => import("../../routes/sales-channels/sales-channel-edit"),
                        },
                        {
                          path: "add-products",
                          lazy: () => import("../../routes/sales-channels/sales-channel-add-products"),
                        },
                        {
                          path: "metadata/edit",
                          lazy: () => import("../../routes/sales-channels/sales-channel-metadata"),
                        },
                      ],
                    },
                  ],
                },
                // Return Reasons
                {
                  path: "return-reasons",
                  errorElement: <ErrorBoundary />,
                  element: <Outlet />,
                  handle: {
                    breadcrumb: () => "Return Reasons",
                  },
                  children: [
                    {
                      path: "",
                      lazy: () => import("../../routes/return-reasons/return-reason-list"),
                      children: [
                        {
                          path: "create",
                          lazy: () => import("../../routes/return-reasons/return-reason-create"),
                        },
                      ],
                    },
                    {
                      path: ":id/edit",
                      lazy: () => import("../../routes/return-reasons/return-reason-edit"),
                    },
                  ],
                },
                // Refund Reasons
                {
                  path: "refund-reasons",
                  errorElement: <ErrorBoundary />,
                  element: <Outlet />,
                  handle: {
                    breadcrumb: () => "Refund Reasons",
                  },
                  children: [
                    {
                      path: "",
                      lazy: () => import("../../routes/refund-reasons/refund-reason-list"),
                      children: [
                        {
                          path: "create",
                          lazy: () => import("../../routes/refund-reasons/refund-reason-create"),
                        },
                      ],
                    },
                    {
                      path: ":id/edit",
                      lazy: () => import("../../routes/refund-reasons/refund-reason-edit"),
                    },
                  ],
                },
                // Payment Config
                {
                  path: "payment-providers",
                  errorElement: <ErrorBoundary />,
                  element: <Outlet />,
                  handle: {
                    breadcrumb: () => "Payment Config",
                  },
                  children: [
                    {
                      path: "",
                      lazy: () => import("../../routes/settings/payment-providers"),
                      children: [
                        {
                          path: "create",
                          lazy: () =>
                            import(
                              "../../routes/settings/payment-providers/payment-config-create"
                            ),
                        },
                      ],
                    },
                  ],
                },
                // Tax Regions
                {
                  path: "tax-regions",
                  element: <Outlet />,
                  handle: {
                    breadcrumb: () => "Tax Regions",
                  },
                  children: [
                    {
                      path: "",
                      lazy: () => import("../../routes/tax-regions/tax-region-list"),
                      children: [
                        {
                          path: "create",
                          lazy: () => import("../../routes/tax-regions/tax-region-create"),
                        },
                      ],
                    },
                    {
                      path: ":id",
                      Component: Outlet,
                      loader: taxRegionLoader,
                      handle: {
                        breadcrumb: (match: UIMatch<HttpTypes.AdminTaxRegionResponse>) =>
                          <TaxRegionDetailBreadcrumb {...match} />,
                      },
                      children: [
                        {
                          path: "",
                          lazy: async () => {
                            const { Component } = await import(
                              "../../routes/tax-regions/tax-region-detail"
                            )
                            return { Component }
                          },
                          children: [
                            {
                              path: "edit",
                              lazy: () => import("../../routes/tax-regions/tax-region-edit"),
                            },
                            {
                              path: "provinces/create",
                              lazy: () => import("../../routes/tax-regions/tax-region-province-create"),
                            },
                            {
                              path: "overrides/create",
                              lazy: () => import("../../routes/tax-regions/tax-region-tax-override-create"),
                            },
                            {
                              path: "overrides/:tax_rate_id/edit",
                              lazy: () => import("../../routes/tax-regions/tax-region-tax-override-edit"),
                            },
                            {
                              path: "tax-rates/create",
                              lazy: () => import("../../routes/tax-regions/tax-region-tax-rate-create"),
                            },
                            {
                              path: "tax-rates/:tax_rate_id/edit",
                              lazy: () => import("../../routes/tax-regions/tax-region-tax-rate-edit"),
                            },
                          ],
                        },
                        {
                          path: "provinces/:province_id",
                          lazy: async () => {
                            const { Component, Breadcrumb, loader } = await import(
                              "../../routes/tax-regions/tax-region-province-detail"
                            )
                            return {
                              Component,
                              loader,
                              handle: {
                                breadcrumb: (match: UIMatch<HttpTypes.AdminTaxRegionResponse>) =>
                                  <Breadcrumb {...match} />,
                              },
                            }
                          },
                          children: [
                            {
                              path: "tax-rates/create",
                              lazy: () => import("../../routes/tax-regions/tax-region-tax-rate-create"),
                            },
                            {
                              path: "tax-rates/:tax_rate_id/edit",
                              lazy: () => import("../../routes/tax-regions/tax-region-tax-rate-edit"),
                            },
                            {
                              path: "overrides/create",
                              lazy: () => import("../../routes/tax-regions/tax-region-tax-override-create"),
                            },
                            {
                              path: "overrides/:tax_rate_id/edit",
                              lazy: () => import("../../routes/tax-regions/tax-region-tax-override-edit"),
                            },
                          ],
                        },
                      ],
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
          path: "/verify-email",
          lazy: () => import("../../routes/verify-email/index"),
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
