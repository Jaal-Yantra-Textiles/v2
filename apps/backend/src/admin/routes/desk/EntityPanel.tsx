import { ReactNode } from "react"
import {
  MemoryRouter,
  Route,
  Routes,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
} from "react-router-dom"

/**
 * Resets React Router's location, navigation, and route contexts so a
 * child MemoryRouter does not trip the "Router inside Router" guard AND
 * inner <Routes> compute their paths from "/" rather than concatenating
 * onto the parent /desk-flex route path. This is the core enabler for
 * panel-scoped navigation inside the workspace.
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

export type EntityRoute = {
  path: string
  element: ReactNode
  children?: EntityRoute[]
}

export type EntityPanelConfig = {
  /** Where the inner MemoryRouter starts (defaults to first route's path) */
  initialPath?: string
  /** Routes to register inside the panel */
  routes: EntityRoute[]
}

const renderRoute = (r: EntityRoute): ReactNode => (
  <Route key={r.path} path={r.path} element={r.element}>
    {r.children?.map(renderRoute)}
  </Route>
)

export const EntityPanel = ({ config }: { config: EntityPanelConfig }) => {
  const initial = config.initialPath || config.routes[0]?.path || "/"
  return (
    <div className="h-full overflow-auto">
      <RouterReset>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>{config.routes.map(renderRoute)}</Routes>
        </MemoryRouter>
      </RouterReset>
    </div>
  )
}
