import { HttpTypes } from "@medusajs/types"
import type { UIMatch } from "react-router-dom"
import { Outlet, RouteObject } from "react-router-dom"

import { ProtectedRoute } from "../../components/authentication/protected-route"
import { MainLayout } from "../../components/layout/main-layout"
import { SettingsLayout } from "../../components/layout/settings-layout"
import { PublicLayout } from "../../components/layout/public-layout"
import { ErrorBoundary } from "../../components/utilities/error-boundary"
import { TaxRegionDetailBreadcrumb } from "../../routes/tax-regions/tax-region-detail/breadcrumb"
import { taxRegionLoader } from "../../routes/tax-regions/tax-region-detail/loader"

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
                    {
                      path: "submit-payment",
                      lazy: () =>
                        import(
                          "../../routes/inventory-orders/inventory-order-submit-payment"
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
                  path: "",
                  lazy: () => import("../../routes/production-runs/production-run-list"),
                },
                {
                  path: ":id",
                  handle: {
                    breadcrumb: (match?: UIMatch) =>
                      match?.params?.id || "Production Run",
                  },
                  lazy: () => import("../../routes/production-runs/production-run-detail"),
                  children: [
                    {
                      path: "tasks/:task_id",
                      lazy: () =>
                        import(
                          "../../routes/production-runs/production-run-task-drawer"
                        ),
                    },
                  ],
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
                  path: ":id",
                  lazy: async () => {
                    const { Component, Breadcrumb, loader } = await import(
                      "../../routes/products/product-detail"
                    )
                    return {
                      Component,
                      loader,
                      handle: {
                        breadcrumb: (match: UIMatch<HttpTypes.AdminProductResponse>) =>
                          <Breadcrumb {...match} />,
                      },
                    }
                  },
                  children: [
                    {
                      path: "edit",
                      lazy: () => import("../../routes/products/product-edit"),
                    },
                    {
                      path: "sales-channels",
                      lazy: () =>
                        import("../../routes/products/product-sales-channels"),
                    },
                    {
                      path: "media",
                      lazy: () => import("../../routes/products/product-media"),
                    },
                    {
                      path: "attributes",
                      lazy: () =>
                        import("../../routes/products/product-attributes"),
                    },
                    {
                      path: "organization",
                      lazy: () =>
                        import("../../routes/products/product-organization"),
                    },
                    {
                      path: "prices",
                      lazy: () => import("../../routes/products/product-prices"),
                    },
                    {
                      path: "stock",
                      lazy: () => import("../../routes/products/product-stock"),
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
                        import("../../routes/products/product-create-option"),
                    },
                    {
                      path: "options/:optionId/edit",
                      lazy: () =>
                        import("../../routes/products/product-edit-option"),
                    },
                    {
                      path: "variants/create",
                      lazy: () =>
                        import("../../routes/products/product-create-variant"),
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
