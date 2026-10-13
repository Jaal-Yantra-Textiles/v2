package com.jyt.partner.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The material rows on the complete-run sheet: what the quantity and price
 *  boxes accept, and the line total shown under them. */
class MaterialEntryTest {

    @Test
    fun `keeps digits and one decimal point`() {
        assertEquals("2.5", decimalOnly("2.5"))
        assertEquals("12.50", decimalOnly("₹12.50"))
        assertEquals("1.25", decimalOnly("1.2.5"))
        assertEquals("3", decimalOnly("3 m"))
        assertEquals("", decimalOnly("abc"))
    }

    @Test
    fun `line total is quantity times price, rounded to paise`() {
        assertEquals(1350.0, materialLineTotal("2.5", "540")!!, 0.0)
        assertEquals(33.33, materialLineTotal("1", "33.333")!!, 0.0)
    }

    @Test
    fun `no total until both boxes hold a real number`() {
        assertNull(materialLineTotal("2.5", ""))
        assertNull(materialLineTotal("", "540"))
        assertNull(materialLineTotal("0", "540"))
        assertNull(materialLineTotal(".", "540"))
    }
}
