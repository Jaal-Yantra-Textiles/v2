package com.jyt.partner.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The data keys the backend stamps decide which screen a tapped push opens. */
class PushTargetTest {
    private fun target(vararg pairs: Pair<String, String>) =
        mapOf(*pairs).let { m -> PushManager.targetFrom { m[it] } }

    @Test
    fun designSentOpensTheRun() {
        assertEquals(
            PushManager.Target.Run("prod_run_1"),
            target("production_run_id" to "prod_run_1", "design_id" to "d1", "title" to "New design: Robe"),
        )
    }

    @Test
    fun inventoryOrderSentOpensTheOrder() {
        assertEquals(
            PushManager.Target.InventoryOrder("inv_order_1"),
            target("inventory_order_id" to "inv_order_1", "title" to "New inventory order"),
        )
    }

    @Test
    fun blankIdsAndUnknownPushesOpenNothing() {
        // The provider stringifies null as "" — that must not navigate.
        assertNull(target("production_run_id" to "", "design_id" to ""))
        assertEquals(
            PushManager.Target.Run("prod_run_1"),
            target("inventory_order_id" to "", "production_run_id" to "prod_run_1"),
        )
        assertNull(target("title" to "Broadcast"))
    }
}
