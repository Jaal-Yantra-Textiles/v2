package com.jyt.partner.models

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RunMaterialsTest {
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }

    private fun run(body: String): ProductionRun =
        json.decodeFromString(ProductionRun.serializer(), """{"id":"r1",$body}""")

    private val design = DesignDetail(
        id = "d1",
        inventoryItems = listOf(
            DesignInventoryItem(id = "kala-red", title = "Kala Cotton Red"),
            DesignInventoryItem(id = "kala-green", title = "Kala Cotton Green"),
            DesignInventoryItem(id = "linen-red", title = "Linen Red"),
        ),
    )

    // The shape the run-detail route sends: planned_quantity null, a note.
    private val allotted = run(
        """"materials_constrained":true,"materials":[
          {"inventory_item_id":"kala-green","planned_quantity":null,"location_id":"sloc_1",
           "note":"Shawl 100 x 200 cm in Kala cotton green",
           "inventory_item":{"id":"kala-green","title":"Kala Cotton Green","sku":"OTH-SKA-GRE-001"}}
        ]"""
    )

    @Test
    fun `an allotted run offers only its allotment, not the whole BOM`() {
        val options = RunMaterials.optionsFor(allotted, design)
        assertTrue(options.constrained)
        assertEquals(listOf("kala-green"), options.items.map { it.id })
        assertEquals("Kala Cotton Green", options.items.single().title)
    }

    @Test
    fun `the allotment note is carried to the form`() {
        val options = RunMaterials.optionsFor(allotted, design)
        assertEquals("Shawl 100 x 200 cm in Kala cotton green", options.notes["kala-green"])
    }

    @Test
    fun `a run with no allotment keeps the design's full BOM`() {
        val options = RunMaterials.optionsFor(run(""""quantity":1"""), design)
        assertFalse(options.constrained)
        assertEquals(listOf("kala-red", "kala-green", "linen-red"), options.items.map { it.id })
        assertTrue(options.notes.isEmpty())
    }

    @Test
    fun `an allotment row with no inventory item still decodes`() {
        val odd = run(""""materials":[{"inventory_item_id":"gone","inventory_item":null}]""")
        assertEquals(listOf("gone"), RunMaterials.optionsFor(odd, design).items.map { it.id })
    }
}
