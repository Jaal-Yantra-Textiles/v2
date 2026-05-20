import { defineRouteConfig } from "@medusajs/admin-sdk"
import { GridLayout } from "@medusajs/icons"
import { Text } from "@medusajs/ui"
import {
  Action,
  Actions,
  BorderNode,
  DockLocation,
  IJsonModel,
  ITabSetRenderValues,
  Layout,
  Model,
  TabNode,
  TabSetNode,
} from "flexlayout-react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  getTabPathnames,
  setFocusedTab,
  subscribeTabStore,
  useActiveTab,
} from "./active-tab-store"
import { EmptyDesk } from "./EmptyDesk"
import { EntityPanel } from "./EntityPanel"
import {
  ENTITY_REGISTRY,
  EntityPickerDropdown,
  type EntityKey,
} from "./EntityPicker"
import {
  clearPersisted,
  loadPersisted,
  persistFromModel,
} from "./persistence"
import { useDeskWorkspace } from "./use-desk-workspace"
import "flexlayout-react/style/light.css"
import "./desk.css"

/**
 * Desk — multi-pane workspace at /admin/desk using flexlayout-react.
 *
 * Each tab is an entity instance rendered via EntityPanel, which wraps
 * the route subtree in its own MemoryRouter so panel-internal navigation
 * (clicking a row, opening an overlay) stays inside the tab.
 *
 * UX:
 *   - No tabs → centered EmptyDesk with entity card grid.
 *   - At least one tab → FlexLayout tab strip with a "+" picker in every
 *     tabset, plus a breadcrumb showing "← Desk · {ActiveEntity} · {path}".
 *
 * The breadcrumb communicates with the active tab through a small
 * module-level active-tab-store — no lifted React context required.
 */

const DESK_ADD_PANEL_EVENT = "desk:add-panel"

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
 * Truth source for "is the workspace empty" — the FlexLayout model, not
 * the active-tab-store. The store only populates when EntityPanels mount;
 * if we gated Layout rendering on the store, the very first click on an
 * empty desk would deadlock: model has a tab, store doesn't yet, Layout
 * stays hidden, tab never mounts.
 */
const modelHasAnyTab = (model: Model): boolean => {
  let found = false
  model.visitNodes((n) => {
    if (n.getType() === "tab") found = true
  })
  return found
}

/** Find the first tabset in the model — used as the default insertion target. */
const firstTabsetId = (model: Model): string | undefined => {
  let id: string | undefined
  model.visitNodes((n) => {
    if (!id && n.getType() === "tabset") id = n.getId()
  })
  return id
}

const Desk = () => {
  // Single read of localStorage at mount: gives us layout + tab_paths in
  // one shot, applies any forward-migration from the legacy v2 split keys.
  const persistedRef = useRef(loadPersisted())
  const [model, setModel] = useState<Model>(() =>
    Model.fromJson(persistedRef.current.layout ?? buildEmptyJson())
  )
  const [hasTabs, setHasTabs] = useState(() => modelHasAnyTab(model))
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
  const persistedPathsRef = useRef<Record<string, string>>(
    persistedRef.current.tab_paths
  )

  const {
    workspace: serverWorkspace,
    isReady: serverReady,
    save: saveToServer,
    reset: resetServer,
  } = useDeskWorkspace()

  const resetWorkspace = useCallback(() => {
    // Drop everything: server, localStorage, in-memory model. Skip the
    // reconcile-from-server guard so the next mount actually starts clean.
    void resetServer()
    clearPersisted()
    hasReconciledRef.current = true
    persistedPathsRef.current = {}
    const fresh = Model.fromJson(buildEmptyJson())
    setModel(fresh)
    setHasTabs(false)
  }, [resetServer])
  /**
   * Server reconcile: the first GET response replaces the local model
   * ONLY if the local model is empty (no tabs). This handles the
   * cross-browser case — a new browser starts empty and adopts the
   * server snapshot — without ever wiping a session the user is
   * already working in.
   */
  const hasReconciledRef = useRef(false)
  useEffect(() => {
    if (!serverReady || hasReconciledRef.current) return
    hasReconciledRef.current = true
    if (!serverWorkspace?.layout) return
    if (modelHasAnyTab(model)) return // user is already working — don't clobber

    try {
      const incoming = Model.fromJson(serverWorkspace.layout as IJsonModel)
      persistedPathsRef.current = {
        ...persistedPathsRef.current,
        ...(serverWorkspace.tab_paths || {}),
      }
      setModel(incoming)
      setHasTabs(modelHasAnyTab(incoming))
      persistFromModel(incoming, serverWorkspace.tab_paths || {})
    } catch {
      // malformed server blob — keep local
    }
  }, [serverReady, serverWorkspace, model])

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

  /**
   * Adds a tab directly via model.doAction(Actions.addNode(...)) rather
   * than the Layout-ref API. This means it works *before* the Layout has
   * mounted — important because we conditionally render Layout vs
   * EmptyDesk, and the first click on an empty desk happens while Layout
   * is still unmounted.
   */
  const addPanel = useCallback(
    (entityKey: EntityKey) => {
      counterRef.current[entityKey] = (counterRef.current[entityKey] || 0) + 1
      const n = counterRef.current[entityKey]
      const entity = ENTITY_REGISTRY[entityKey]
      const tabId = `${entityKey}-${n}-${Date.now()}`

      const targetTabsetId = firstTabsetId(model)
      if (!targetTabsetId) return

      model.doAction(
        Actions.addNode(
          {
            type: "tab",
            id: tabId,
            name: `${entity.label} ${n}`,
            component: entityKey,
          },
          targetTabsetId,
          DockLocation.CENTER,
          -1,
          true
        )
      )
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

  /**
   * On every model action: update hasTabs (derived state), mirror the
   * selected tab to the active-tab-store so the breadcrumb sees it,
   * persist to localStorage instantly, and queue a debounced PUT to the
   * server so the layout follows the user across browsers.
   */
  const onModelChange = useCallback(
    (m: Model, _action: Action) => {
      setHasTabs(modelHasAnyTab(m))
      const tabset = m.getActiveTabset()
      setFocusedTab(tabset?.getSelectedNode()?.getId() ?? null)
      const paths = getTabPathnames()
      persistFromModel(m, paths)
      saveToServer({ layout: m.toJson(), tab_paths: paths })
    },
    [saveToServer]
  )

  // Mirror tab path changes into localStorage AND queue a server save.
  useEffect(() => {
    const unsub = subscribeTabStore(() => {
      const paths = getTabPathnames()
      persistFromModel(model, paths)
      saveToServer({ layout: model.toJson(), tab_paths: paths })
    })
    return unsub
  }, [model, saveToServer])

  // After hydration, point the breadcrumb at whatever tab is selected.
  useEffect(() => {
    const tabset = model.getActiveTabset()
    setFocusedTab(tabset?.getSelectedNode()?.getId() ?? null)
  }, [model])

  const onRenderTabSet = useCallback(
    (_node: TabSetNode | BorderNode, renderValues: ITabSetRenderValues) => {
      renderValues.stickyButtons.push(
        <EntityPickerDropdown
          key="add-tab"
          onSelect={addPanel}
          onReset={resetWorkspace}
        />
      )
    },
    [addPanel, resetWorkspace]
  )

  // Layout must always be mounted so its onModelChange is wired and can
  // flip hasTabs to true when the first tab arrives. EmptyDesk is an
  // overlay shown on top while the model has no tabs.
  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      <div className="flex-1 min-h-0 relative">
        <Layout
          model={model}
          factory={factory}
          onModelChange={onModelChange}
          onRenderTabSet={onRenderTabSet}
        />
        {!hasTabs && (
          <div className="absolute inset-0 z-10 bg-ui-bg-base">
            <EmptyDesk onSelect={addPanel} />
          </div>
        )}
      </div>
    </div>
  )
}

const DeskBreadcrumb = () => {
  const activeTab = useActiveTab()

  if (!activeTab) {
    return <span className="text-ui-fg-base">Desk</span>
  }

  return (
    <div className="flex items-center gap-x-2">
      <Text size="small" className="text-ui-fg-base">
        Desk
      </Text>
      <Text size="small" className="text-ui-fg-muted">
        ·
      </Text>
      <Text size="small" weight="plus">
        {activeTab.entityLabel}
      </Text>
      <Text
        size="small"
        className="text-ui-fg-subtle font-mono truncate max-w-[280px]"
      >
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
