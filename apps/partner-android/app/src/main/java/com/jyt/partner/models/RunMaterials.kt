package com.jyt.partner.models

/**
 * Which materials to offer a partner when completing a run — the Android
 * twin of partner-ui's `resolveRunMaterialOptions`.
 *
 * A run can be ALLOTTED a subset of its design's bill of materials, and the
 * backend REFUSES consumption outside it: ticking one non-allotted item fails
 * the whole completion. So when an allotment exists, offer only it. A run with
 * no allotment is unconstrained (nobody chose, not "chose nothing") and keeps
 * the design's full BOM, as every run did before allotments existed.
 */
data class RunMaterialOptions(
    val items: List<DesignInventoryItem>,
    /** True when [items] is the run's allotment rather than the whole BOM. */
    val constrained: Boolean,
    /** Allotment notes by inventory item id; empty when unconstrained. */
    val notes: Map<String, String>,
)

object RunMaterials {
    fun optionsFor(run: ProductionRun?, design: DesignDetail?): RunMaterialOptions {
        val allotted = run?.materials.orEmpty()
        if (allotted.isNotEmpty()) {
            return RunMaterialOptions(
                items = allotted.map { row ->
                    DesignInventoryItem(
                        id = row.inventoryItemId,
                        title = row.inventoryItem?.title,
                        sku = row.inventoryItem?.sku,
                    )
                },
                constrained = true,
                notes = allotted.mapNotNull { row ->
                    row.note?.trim()?.takeIf { it.isNotEmpty() }?.let { row.inventoryItemId to it }
                }.toMap(),
            )
        }
        return RunMaterialOptions(
            items = design?.inventoryItems.orEmpty(),
            constrained = false,
            notes = emptyMap(),
        )
    }
}
