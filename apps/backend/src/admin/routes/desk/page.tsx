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
import { useEffect, useRef, useState } from "react"
import { EntityPanel } from "./EntityPanel"
import { designsEntityConfig } from "./entities/designs"
import { productionRunsEntityConfig } from "./entities/production-runs"
import { partnersEntityConfig } from "./entities/partners"
import { mediasEntityConfig } from "./entities/medias"
import "flexlayout-react/style/light.css"

/**
 * Desk — multi-pane workspace at /admin/desk using flexlayout-react.
 *
 * Each tab is an entity instance (Designs, etc.) rendered via EntityPanel,
 * which wraps the route subtree in its own MemoryRouter so panel-internal
 * navigation (clicking a row, opening an overlay) stays inside the tab.
 *
 * The toolbar lives in the breadcrumb area (handle.breadcrumb) and
 * dispatches CustomEvents the page picks up to open new tabs — this keeps
 * controls visible in the topbar without lifting pane state to a store.
 */

const ENTITY_REGISTRY = {
  designs: {
    label: "Designs",
    config: designsEntityConfig,
  },
  "production-runs": {
    label: "Production Runs",
    config: productionRunsEntityConfig,
  },
  partners: {
    label: "Partners",
    config: partnersEntityConfig,
  },
  medias: {
    label: "Medias",
    config: mediasEntityConfig,
  },
} as const

type EntityKey = keyof typeof ENTITY_REGISTRY

const DESK_ADD_PANEL_EVENT = "desk:add-panel"

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
            id: "designs-1",
            name: "Designs 1",
            component: "designs",
          },
        ],
      },
    ],
  },
}

const factory = (node: TabNode) => {
  const c = node.getComponent() as EntityKey
  const entity = ENTITY_REGISTRY[c]
  if (!entity) return null
  return <EntityPanel config={entity.config} />
}

const Desk = () => {
  const [model] = useState(() => Model.fromJson(initialJson))
  const layoutRef = useRef<ILayoutApi>(null)
  const counterRef = useRef<Record<EntityKey, number>>({
    designs: 1,
    "production-runs": 0,
    partners: 0,
    medias: 0,
  })

  const addPanel = (entityKey: EntityKey) => {
    counterRef.current[entityKey] = (counterRef.current[entityKey] || 0) + 1
    const n = counterRef.current[entityKey]
    const entity = ENTITY_REGISTRY[entityKey]
    layoutRef.current?.addTabToActiveTabSet({
      type: "tab",
      id: `${entityKey}-${n}-${Date.now()}`,
      name: `${entity.label} ${n}`,
      component: entityKey,
    })
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ entity: EntityKey }>).detail
      if (detail?.entity && ENTITY_REGISTRY[detail.entity]) {
        addPanel(detail.entity)
      }
    }
    window.addEventListener(DESK_ADD_PANEL_EVENT, handler)
    return () => window.removeEventListener(DESK_ADD_PANEL_EVENT, handler)
  }, [])

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      <div className="flex-1 min-h-0 relative">
        <Layout ref={layoutRef} model={model} factory={factory} />
      </div>
    </div>
  )
}

const DeskBreadcrumb = () => {
  const fire = (entity: EntityKey) =>
    window.dispatchEvent(
      new CustomEvent(DESK_ADD_PANEL_EVENT, { detail: { entity } })
    )
  return (
    <div className="flex items-center gap-x-2">
      <span className="text-ui-fg-base">Desk</span>
      {(Object.entries(ENTITY_REGISTRY) as [EntityKey, typeof ENTITY_REGISTRY[EntityKey]][]).map(
        ([key, entity]) => (
          <Button
            key={key}
            size="small"
            variant="secondary"
            onClick={() => fire(key)}
          >
            + {entity.label}
          </Button>
        )
      )}
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
