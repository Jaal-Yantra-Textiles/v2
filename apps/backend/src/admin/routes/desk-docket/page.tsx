import { defineRouteConfig } from "@medusajs/admin-sdk"
import { LayoutLeftRight } from "@medusajs/icons"
import { Button } from "@medusajs/ui"
import {
  DockviewApi,
  DockviewReact,
  DockviewReadyEvent,
  IDockviewPanelProps,
} from "dockview-react"
import { ReactNode, useEffect, useRef } from "react"
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
import "dockview-react/dist/styles/dockview.css"

/**
 * Resets React Router's location, navigation, and route contexts so a child
 * MemoryRouter does not trip the "Router inside Router" guard AND inner
 * <Routes> compute their paths from "/" rather than concatenating onto the
 * parent /desk-docket route path.
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
 * DeskDocket — workspace prototype using dockview-react.
 *
 * Two panel kinds for A/B-ing the architecture:
 *   - designsIframe: <iframe src="/app/designs"> — full admin chrome,
 *     each panel fully isolated routing context.
 *   - designsComponent: <DesignsPage /> wrapped in its own MemoryRouter,
 *     so clicking a row navigates inside the panel (not the whole app).
 *     V0 supports list + detail; nested overlay routes (@edit, @tasks, etc.)
 *     are not mapped yet.
 */

const DesignsIframePanel = (_props: IDockviewPanelProps) => (
  <iframe
    src="/app/designs"
    title="Designs"
    style={{ width: "100%", height: "100%", border: 0 }}
  />
)

const DesignsComponentPanel = (_props: IDockviewPanelProps) => (
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

const components = {
  designsIframe: DesignsIframePanel,
  designsComponent: DesignsComponentPanel,
}

/**
 * Event bridge between the breadcrumb-area toolbar (rendered by
 * handle.breadcrumb, outside this component's subtree) and the workspace
 * page state below. Custom events keep both ends decoupled — no shared
 * module-level store needed for the prototype.
 */
const DESK_DOCKET_ADD_PANEL_EVENT = "desk-docket:add-panel"

const DeskDocket = () => {
  const apiRef = useRef<DockviewApi | null>(null)
  const counterRef = useRef({ iframe: 0, component: 0 })

  const addPanel = (kind: "iframe" | "component") => {
    const api = apiRef.current
    if (!api) return
    counterRef.current[kind] += 1
    const n = counterRef.current[kind]
    api.addPanel({
      id: `designs-${kind}-${n}-${Date.now()}`,
      component: kind === "iframe" ? "designsIframe" : "designsComponent",
      title: `Designs ${kind === "iframe" ? "iframe" : "comp"} ${n}`,
      position: api.activePanel
        ? { referencePanel: api.activePanel.id, direction: "right" }
        : undefined,
    })
  }

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api
    counterRef.current.iframe = 1
    event.api.addPanel({
      id: "designs-iframe-1",
      component: "designsIframe",
      title: "Designs iframe 1",
    })
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ kind: "iframe" | "component" }>).detail
      if (detail?.kind) addPanel(detail.kind)
    }
    window.addEventListener(DESK_DOCKET_ADD_PANEL_EVENT, handler)
    return () => window.removeEventListener(DESK_DOCKET_ADD_PANEL_EVENT, handler)
  }, [])

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      <div className="flex-1 min-h-0">
        <DockviewReact
          components={components}
          onReady={onReady}
          className="dockview-theme-light"
        />
      </div>
    </div>
  )
}

const DeskDocketBreadcrumb = () => {
  const fire = (kind: "iframe" | "component") =>
    window.dispatchEvent(
      new CustomEvent(DESK_DOCKET_ADD_PANEL_EVENT, { detail: { kind } })
    )
  return (
    <div className="flex items-center gap-x-2">
      <span className="text-ui-fg-base">Desk (Dockview)</span>
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
  label: "Desk (Dockview)",
  icon: LayoutLeftRight,
})

export const handle = {
  breadcrumb: () => <DeskDocketBreadcrumb />,
}

export default DeskDocket
