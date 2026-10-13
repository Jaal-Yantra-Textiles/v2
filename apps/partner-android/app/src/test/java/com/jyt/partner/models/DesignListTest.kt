package com.jyt.partner.models

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DesignListTest {
    private fun row(
        thumbnail: String? = null,
        media: List<MediaFile>? = null,
        partnerStatus: String? = null,
    ) = PartnerDesignRow(
        id = "d1",
        thumbnailUrl = thumbnail,
        mediaFiles = media,
        partnerInfo = partnerStatus?.let { PartnerInfo(partnerStatus = it) },
    )

    @Test
    fun `the design's own thumbnail wins`() {
        val r = row(thumbnail = "own.jpg", media = listOf(MediaFile(url = "flag.jpg", isThumbnail = true)))
        assertEquals("own.jpg", r.displayThumbnail)
    }

    @Test
    fun `without one, the flagged media file, then the first`() {
        val flagged = row(
            media = listOf(MediaFile(url = "a.jpg"), MediaFile(url = "b.jpg", isThumbnail = true)),
        )
        assertEquals("b.jpg", flagged.displayThumbnail)
        assertEquals("a.jpg", row(thumbnail = " ", media = listOf(MediaFile(url = "a.jpg"))).displayThumbnail)
    }

    @Test
    fun `no picture at all falls back to the initial`() {
        assertNull(row().displayThumbnail)
        assertNull(row(media = listOf(MediaFile(url = ""))).displayThumbnail)
    }

    @Test
    fun `partner status comes from partner_info, blank is none`() {
        assertEquals("in_progress", row(partnerStatus = "in_progress").partnerStatus)
        assertNull(row(partnerStatus = "").partnerStatus)
        assertNull(row().partnerStatus)
    }

    @Test
    fun `status labels are plain words`() {
        assertEquals("In development", designStatusLabel("In_Development"))
        assertEquals("Awaiting review", designStatusLabel("awaiting_review"))
        assertEquals("Approved", designStatusLabel("Approved"))
        assertNull(designStatusLabel(null))
        assertNull(designStatusLabel("  "))
    }

    @Test
    fun `search sends the trimmed text, blank sends nothing`() {
        assertEquals("kani stole", designSearchQuery("  kani stole "))
        assertNull(designSearchQuery(""))
        assertNull(designSearchQuery("   "))
    }
}
