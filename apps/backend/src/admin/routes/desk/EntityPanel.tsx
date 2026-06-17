import { ReactNode, useEffect } from "react"
import {
  MemoryRouter,
  Route,
  Routes,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
  useLocation,
  useNavigate,
} from "react-router-dom"
import { clearTabState, setTabState } from "./active-tab-store"
import { DeskRouteFallback } from "./DeskRouteFallback"

/**
 * Resets React Router's location, navigation, and route contexts so a
 * child MemoryRouter does not trip the "Router inside Router" guard AND
 * inner <Routes> compute their paths from "/" rather than concatenating
 * onto the parent /desk route path. This is the core enabler for
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

/**
 * Publishes the tab's current path + a navigate ref to the active-tab
 * store so the breadcrumb (rendered outside this subtree) can show
 * where we are and offer a back affordance. Lives inside the inner
 * MemoryRouter so its hooks resolve against the panel's router, not
 * the admin shell's BrowserRouter.
 */
const TabStatePublisher = ({
  tabId,
  entityKey,
  entityLabel,
}: {
  tabId: string
  entityKey: string
  entityLabel: string
}) => {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    setTabState({
      tabId,
      entityKey,
      entityLabel,
      pathname: location.pathname,
      navigate: (delta) => navigate(delta),
    })
  }, [tabId, entityKey, entityLabel, location.pathname, navigate])

  useEffect(
    () => () => {
      clearTabState(tabId)
    },
    [tabId]
  )

  return null
}

export const EntityPanel = ({
  config,
  tabId,
  entityKey,
  entityLabel,
  initialPath,
}: {
  config: EntityPanelConfig
  tabId: string
  entityKey: string
  entityLabel: string
  /**
   * Override for the inner MemoryRouter's starting path — used when the
   * desk hydrates from a persisted layout so each tab resumes on the
   * exact route it was on last time, not the entity's list page.
   */
  initialPath?: string
}) => {
  const initial =
    initialPath || config.initialPath || config.routes[0]?.path || "/"

  // The panel takes the full FlexLayout tab height and scrolls its content.
  // `bg-ui-bg-subtle` matches the admin's standard page surface so the page's
  // own white cards stand out instead of floating on raw white. `pt-4 px-3`
  // gives the content breathing room from the tab strip and pane edges rather
  // than butting flush against them. `min-h-full` lets a tall page grow.
  return (
    <div className="h-full overflow-auto bg-ui-bg-subtle">
      <div className="min-h-full pt-4 px-3 pb-3">
        <RouterReset>
          <MemoryRouter initialEntries={[initial]}>
            <TabStatePublisher
              tabId={tabId}
              entityKey={entityKey}
              entityLabel={entityLabel}
            />
            <Routes>
              {config.routes.map(renderRoute)}
              <Route
                path="*"
                element={<DeskRouteFallback entityLabel={entityLabel} />}
              />
            </Routes>
          </MemoryRouter>
        </RouterReset>
      </div>
    </div>
  )
}
