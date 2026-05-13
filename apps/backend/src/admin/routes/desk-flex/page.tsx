import { defineRouteConfig } from "@medusajs/admin-sdk"
import { GridLayout } from "@medusajs/icons"
import { Button } from "@medusajs/ui"
import {
  IJsonModel,
  ILayoutApi,
  Layout,
  Model,
  TabNode,
} from "flexlayout-react"
import { ReactNode, useEffect, useRef, useState } from "react"
import {
  MemoryRouter,
  Route,
  Routes,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
} from "react-router-dom"
import DesignsPage from "../designs/page"
import DesignDetailPage from "../designs/[id]/page"
import "flexlayout-react/style/light.css"

/**
 * Resets React Router's location, navigation, and route contexts so a child
 * MemoryRouter does not trip the "Router inside Router" guard AND inner
 * <Routes> compute their paths from "/" rather than concatenating onto the
 * parent /desk-flex route path.
 */
const EMPTY_ROUTE_CONTEXT = { outlet: null, matches: [], isDataRoute: false }
const RouterReset = ({ children }: { children: ReactNode }) => (
  <UNSAFE_NavigationContext.Provider value={null as any}>
    <UNSAFE_LocationContext.Provider value={null as any}>
      <UNSAFE_RouteContext.Provider value={EMPTY_ROUTE_CONTEXT}>
        {children}
      </UNSAFE_RouteContext.Provider>
    </UNSAFE_LocationContext.Provider>
  </UNSAFE_NavigationContext.Provider>
)

/**
 * DeskFlex — workspace prototype using flexlayout-react.
 *
 * Two panel kinds for A/B-ing the architecture:
 *   - "designs-iframe": iframe pointing at /app/designs (full chrome, own
 *     routing context).
 *   - "designs-component": <DesignsPage /> wrapped in its own MemoryRouter
 *     so clicking a row navigates inside the panel (not the whole app).
 *     V0 supports list + detail; nested overlay routes (@edit, @tasks, etc.)
 *     are not mapped yet.
 */

const initialJson: IJsonModel = {
  global: {
    tabEnableRenderOnDemand: false,
    tabSetEnableDeleteWhenEmpty: true,
  },
  borders: [],
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "tabset",
        weight: 100,
        active: true,
        children: [
          {
            type: "tab",
            id: "designs-iframe-1",
            name: "Designs iframe 1",
            component: "designs-iframe",
          },
        ],
      },
    ],
  },
}

const factory = (node: TabNode) => {
  const c = node.getComponent()
  if (c === "designs-iframe") {
    return (
      <iframe
        src="/app/designs"
        title="Designs"
        style={{ width: "100%", height: "100%", border: 0 }}
      />
    )
  }
  if (c === "designs-component") {
    return (
      <div className="h-full overflow-auto">
        <RouterReset>
          <MemoryRouter initialEntries={["/designs"]}>
            <Routes>
              <Route path="/designs" element={<DesignsPage />} />
              <Route path="/designs/:id/*" element={<DesignDetailPage />} />
            </Routes>
          </MemoryRouter>
        </RouterReset>
      </div>
    )
  }
  return null
}

/**
 * Event bridge between the breadcrumb-area toolbar (rendered by
 * handle.breadcrumb, outside this component's subtree) and the workspace
 * page state below. Custom events keep both ends decoupled — no shared
 * module-level store needed for the prototype.
 */
const DESK_FLEX_ADD_PANEL_EVENT = "desk-flex:add-panel"

const DeskFlex = () => {
  const [model] = useState(() => Model.fromJson(initialJson))
  const layoutRef = useRef<ILayoutApi>(null)
  const counterRef = useRef({ iframe: 1, component: 0 })

  const addPanel = (kind: "iframe" | "component") => {
    counterRef.current[kind] += 1
    const n = counterRef.current[kind]
    layoutRef.current?.addTabToActiveTabSet({
      type: "tab",
      id: `designs-${kind}-${n}-${Date.now()}`,
      name: `Designs ${kind} ${n}`,
      component: `designs-${kind}`,
    })
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ kind: "iframe" | "component" }>).detail
      if (detail?.kind) addPanel(detail.kind)
    }
    window.addEventListener(DESK_FLEX_ADD_PANEL_EVENT, handler)
    return () => window.removeEventListener(DESK_FLEX_ADD_PANEL_EVENT, handler)
  }, [])

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      <div className="flex-1 min-h-0 relative">
        <Layout ref={layoutRef} model={model} factory={factory} />
      </div>
    </div>
  )
}

const DeskFlexBreadcrumb = () => {
  const fire = (kind: "iframe" | "component") =>
    window.dispatchEvent(
      new CustomEvent(DESK_FLEX_ADD_PANEL_EVENT, { detail: { kind } })
    )
  return (
    <div className="flex items-center gap-x-2">
      <span className="text-ui-fg-base">Desk (FlexLayout)</span>
      <Button size="small" variant="secondary" onClick={() => fire("iframe")}>
        + iframe
      </Button>
      <Button size="small" variant="secondary" onClick={() => fire("component")}>
        + component
      </Button>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Desk (FlexLayout)",
  icon: GridLayout,
})

export const handle = {
  breadcrumb: () => <DeskFlexBreadcrumb />,
}

export default DeskFlex
