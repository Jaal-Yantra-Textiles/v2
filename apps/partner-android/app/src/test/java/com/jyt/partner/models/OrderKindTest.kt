package com.jyt.partner.models

import kotlinx.serialization.json.Json
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OrderKindTest {
    // The app's own decoder settings (PartnerApi.json).
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        explicitNulls = false
    }

    private fun order(extra: String): PartnerOrder =
        json.decodeFromString(PartnerOrder.serializer(), """{"id":"order_1","display_id":152$extra}""")

    @Test
    fun `the typed kind says bundle`() {
        assertTrue(order(""","unified_order_kind":{"kind":"collated"}""").isCollated)
    }

    @Test
    fun `an explicit per_run wins over the old metadata flag`() {
        assertFalse(
            order(""","unified_order_kind":{"kind":"per_run"},"metadata":{"collated_design_order":true}""")
                .isCollated,
        )
    }

    @Test
    fun `no kind falls back to the metadata flag`() {
        assertTrue(order(""","metadata":{"collated_design_order":true}""").isCollated)
        assertFalse(order(""","metadata":{"collated_design_order":"true"}""").isCollated)
        assertFalse(order(""","metadata":{}""").isCollated)
    }

    @Test
    fun `no kind and no metadata is not a bundle`() {
        assertFalse(order("").isCollated)
        assertFalse(order(""","unified_order_kind":null,"metadata":null""").isCollated)
    }
}
