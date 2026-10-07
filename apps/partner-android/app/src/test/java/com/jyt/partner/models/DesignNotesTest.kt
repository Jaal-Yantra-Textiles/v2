package com.jyt.partner.models

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DesignNotesTest {
    @Test
    fun `plain text notes pass through`() {
        val notes = "Fabric: stretch jersey. Fit: slim body."
        assertEquals(notes, DesignNotes.toText("  $notes \n"))
    }

    @Test
    fun `blank or missing notes show nothing`() {
        assertNull(DesignNotes.toText(null))
        assertNull(DesignNotes.toText("   "))
        assertNull(DesignNotes.toText("""{"type":"doc","content":[{"type":"paragraph"}]}"""))
    }

    @Test
    fun `a TipTap document reads as text, not JSON`() {
        val doc = """{"type":"doc","content":[
          {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Stitching"}]},
          {"type":"paragraph","content":[{"type":"text","text":"Use "},{"type":"text","marks":[{"type":"bold"}],"text":"French seams"},{"type":"hardBreak"},{"type":"text","text":"on the sides."}]},
          {"type":"paragraph"},
          {"type":"bulletList","content":[
            {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Size M first"}]}]},
            {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Then L"}]}]}]},
          {"type":"orderedList","attrs":{"start":3},"content":[
            {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Wash"}]}]}]}
        ]}"""
        assertEquals(
            "Stitching\nUse French seams\non the sides.\n\n• Size M first\n• Then L\n3. Wash",
            DesignNotes.toText(doc),
        )
    }

    @Test
    fun `text that only looks like JSON is kept as typed`() {
        assertEquals("{not json", DesignNotes.toText("{not json"))
        assertEquals("""{"a":1}""", DesignNotes.toText("""{"a":1}"""))
    }
}
