import { Tabs } from "@medusajs/ui"
import { useState } from "react"

import type { AdminDesign } from "../../hooks/api/designs"
import ColorPaletteEditor from "./edit-color-palette"
import { EditDesignSizes } from "./edit-design-sizes"

/**
 * "Edit colours & sizes" on the design graph's palette node.
 *
 * It opened the colour editor only, so sizes, which the node counts, could
 * not be edited from there. Each tab is the same editor its own route uses,
 * with its own Save; switching tabs drops unsaved changes in the other one.
 */
export const EditDesignPalette = ({ design }: { design: AdminDesign }) => {
  const [tab, setTab] = useState<"colours" | "sizes">(design.colors?.length || !design.size_sets?.length ? "colours" : "sizes")

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b px-6 py-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "colours" | "sizes")}>
          <Tabs.List>
            <Tabs.Trigger value="colours">Colours ({design.colors?.length ?? 0})</Tabs.Trigger>
            <Tabs.Trigger value="sizes">Sizes ({design.size_sets?.length ?? 0})</Tabs.Trigger>
          </Tabs.List>
        </Tabs>
      </div>
      {/* key: a fresh editor per tab, so each starts from the saved design. */}
      {tab === "colours" ? (
        <ColorPaletteEditor key="colours" design={design} />
      ) : (
        <EditDesignSizes key="sizes" design={design} />
      )}
    </div>
  )
}

export default EditDesignPalette
