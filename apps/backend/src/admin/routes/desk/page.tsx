import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowLeft, GridLayout } from "@medusajs/icons"
import { IconButton, Text } from "@medusajs/ui"
import {
  Action,
  IJsonModel,
  ILayoutApi,
  ITabSetRenderValues,
  Layout,
  Model,
  TabNode,
  TabSetNode,
  BorderNode,
} from "flexlayout-react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  getTabPathnames,
  setFocusedTab,
  subscribeTabStore,
  useActiveTab,
  useTabCount,
} from "./active-tab-store"
import { EmptyDesk } from "./EmptyDesk"
import { EntityPanel } from "./EntityPanel"
import {
  ENTITY_REGISTRY,
  EntityPickerDropdown,
  type EntityKey,
} from "./EntityPicker"
import "flexlayout-react/style/light.css"

/**
 * Desk — multi-pane workspace at /admin/desk using flexlayout-react.
 *
 * Each tab is an entity instance (Designs, etc.) rendered via EntityPanel,
 * which wraps the route subtree in its own MemoryRouter so panel-internal
 * navigation (clicking a row, opening an overlay) stays inside the tab.
 *
 * UX shape:
 *   - No tabs open → centered EmptyDesk with entity card grid.
 *   - At least one tab → FlexLayout tab strip with a "+" picker, and
 *     the breadcrumb area shows "Desk · {ActiveEntity}" + a back arrow
 *     that calls navigate(-1) inside the active tab.
 *
 * The breadcrumb communicates with the active tab through the small
 * active-tab-store — no lifted React context required.
 */

const DESK_ADD_PANEL_EVENT = "desk:add-panel"
const LAYOUT_STORAGE_KEY = "jyt:desk:layout-v1"
const PATHS_STORAGE_KEY = "jyt:desk:tab-paths-v1"

const buildEmptyJson = (): IJsonModel => ({
  global: {
    tabEnableRenderOnDemand: false,
    tabSetEnableDeleteWhenEmpty: false,
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
        children: [],
      },
    ],
  },
})

/**
 * Hydrate the FlexLayout JSON from localStorage if a valid blob is
 * present, otherwise fall back to an empty workspace. The schema key
 * (-v1) lets us invalidate stored layouts in one shot when EntityPanel
 * config shapes change.
 */
const loadPersistedLayout = (): IJsonModel => {
  if (typeof window === "undefined") return buildEmptyJson()
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return buildEmptyJson()
    const parsed = JSON.parse(raw) as IJsonModel
    if (!parsed?.layout) return buildEmptyJson()
    return parsed
  } catch {
    return buildEmptyJson()
  }
}

const loadPersistedPaths = (): Record<string, string> => {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(PATHS_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

const persistLayout = (model: Model): void => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify(model.toJson())
    )
  } catch {
    // quota / privacy mode — best-effort
  }
}

const persistPaths = (paths: Record<string, string>): void => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(PATHS_STORAGE_KEY, JSON.stringify(paths))
  } catch {
    // best-effort
  }
}

const Desk = () => {
  const [model] = useState<Model>(() => Model.fromJson(loadPersistedLayout()))
  const layoutRef = useRef<ILayoutApi>(null)
  const counterRef = useRef<Record<EntityKey, number>>({
    designs: 0,
    "production-runs": 0,
    partners: 0,
    medias: 0,
  })
  /**
   * Frozen at mount and consumed by the factory on each panel mount.
   * After EntityPanel mounts, its TabStatePublisher takes over and pushes
   * live paths into the active-tab-store; we just need the initial value
   * so the inner MemoryRouter starts on the right route.
   */
  const persistedPathsRef = useRef<Record<string, string>>(loadPersistedPaths())
  const tabCount = useTabCount()

  const factory = useCallback((node: TabNode) => {
    const c = node.getComponent() as EntityKey
    const entity = ENTITY_REGISTRY[c]
    if (!entity) return null
    return (
      <EntityPanel
        config={entity.config}
        tabId={node.getId()}
        entityKey={c}
        entityLabel={entity.label}
        initialPath={persistedPathsRef.current[node.getId()]}
      />
    )
  }, [])

  const addPanel = useCallback(
    (entityKey: EntityKey) => {
      counterRef.current[entityKey] = (counterRef.current[entityKey] || 0) + 1
      const n = counterRef.current[entityKey]
      const entity = ENTITY_REGISTRY[entityKey]
      const tabId = `${entityKey}-${n}-${Date.now()}`

      // If we have an active tabset, add there; otherwise the model has
      // an empty initial tabset we can drop into.
      const added = layoutRef.current?.addTabToActiveTabSet({
        type: "tab",
        id: tabId,
        name: `${entity.label} ${n}`,
        component: entityKey,
      })
      if (!added) {
        // Fallback for the empty model where no tabset is active yet —
        // there's still a tabset from buildEmptyJson, find it and target it.
        let firstTabsetId: string | undefined
        model.visitNodes((node) => {
          if (!firstTabsetId && node.getType() === "tabset") {
            firstTabsetId = node.getId()
          }
        })
        if (firstTabsetId) {
          layoutRef.current?.addTabToTabSet(firstTabsetId, {
            type: "tab",
            id: tabId,
            name: `${entity.label} ${n}`,
            component: entityKey,
          })
        }
      }
    },
    [model]
  )

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ entity: EntityKey }>).detail
      if (detail?.entity && ENTITY_REGISTRY[detail.entity]) {
        addPanel(detail.entity)
      }
    }
    window.addEventListener(DESK_ADD_PANEL_EVENT, handler)
    return () => window.removeEventListener(DESK_ADD_PANEL_EVENT, handler)
  }, [addPanel])

  // Keep the active-tab-store's focused tab id in sync with FlexLayout's
  // selection AND persist the layout JSON to localStorage on every model
  // action (add/move/close/select) so the workspace survives reload.
  const onModelChange = useCallback((m: Model, _action: Action) => {
    const tabset = m.getActiveTabset()
    setFocusedTab(tabset?.getSelectedNode()?.getId() ?? null)
    persistLayout(m)
  }, [])

  // Mirror every internal-path change from the active-tab-store into
  // localStorage so tabs resume on the exact route after reload.
  useEffect(() => {
    const unsub = subscribeTabStore(() => {
      persistPaths(getTabPathnames())
    })
    return unsub
  }, [])

  // After hydration, fire the focused-tab signal once so the breadcrumb
  // wakes up to the persisted active tab without waiting for a click.
  useEffect(() => {
    const tabset = model.getActiveTabset()
    setFocusedTab(tabset?.getSelectedNode()?.getId() ?? null)
  }, [model])

  // Add a "+" picker to every tabset's sticky-buttons area.
  const onRenderTabSet = useCallback(
    (_node: TabSetNode | BorderNode, renderValues: ITabSetRenderValues) => {
      renderValues.stickyButtons.push(
        <EntityPickerDropdown key="add-tab" onSelect={addPanel} />
      )
    },
    [addPanel]
  )

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      <div className="flex-1 min-h-0 relative">
        {tabCount === 0 ? (
          <EmptyDesk onSelect={addPanel} />
        ) : null}
        <div
          className="absolute inset-0"
          style={{ display: tabCount === 0 ? "none" : "block" }}
        >
          <Layout
            ref={layoutRef}
            model={model}
            factory={factory}
            onModelChange={onModelChange}
            onRenderTabSet={onRenderTabSet}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Breadcrumb rendered in the topbar slot. Reads the active tab from the
 * external store. When no tab is focused it just shows "Desk"; when a
 * tab is active it shows the entity label and a back arrow wired to
 * the tab's internal navigate (so clicking "<" calls navigate(-1) inside
 * the active panel's MemoryRouter).
 */
const DeskBreadcrumb = () => {
  const activeTab = useActiveTab()

  if (!activeTab) {
    return <span className="text-ui-fg-base">Desk</span>
  }

  return (
    <div className="flex items-center gap-x-2">
      <IconButton
        size="small"
        variant="transparent"
        aria-label="Back in tab"
        onClick={() => activeTab.navigate(-1)}
      >
        <ArrowLeft />
      </IconButton>
      <Text size="small" className="text-ui-fg-base">
        Desk
      </Text>
      <Text size="small" className="text-ui-fg-muted">
        ·
      </Text>
      <Text size="small" weight="plus">
        {activeTab.entityLabel}
      </Text>
      <Text size="small" className="text-ui-fg-subtle font-mono truncate max-w-[280px]">
        {activeTab.pathname}
      </Text>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Desk",
  icon: GridLayout,
})

export const handle = {
  breadcrumb: () => <DeskBreadcrumb />,
}

export default Desk
