package com.jyt.partner.models

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MoodboardBoardsTest {
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }

    private fun boards(body: String): MoodboardBoardsResponse =
        json.decodeFromString(MoodboardBoardsResponse.serializer(), body)

    private fun scene(vararg urls: String): String {
        val elements = urls.indices.joinToString(",") { """{"type":"image","fileId":"f$it","width":300,"scale":[1,1]}""" }
        val files = urls.withIndex().joinToString(",") { (i, u) -> """"f$i":{"id":"f$i","dataURL":"$u","mimeType":"image/jpeg"}""" }
        // A frame and a text element ride along, as on a real board.
        return """{"type":"excalidraw","elements":[{"type":"frame","name":"Reference"},{"type":"text","text":"Reference: Baethe"},$elements],"files":{$files}}"""
    }

    @Test
    fun `the admin's core board reaches a partner under others`() {
        // Shape of GET /partners/designs/:id/moodboards for a design only the admin has drawn on.
        val response = boards(
            """{"own":null,"others":[{"id":"b1","owner_type":"core","is_own":false,"is_legacy":false,"scene":${scene("https://a/1.jpg", "https://a/2.jpg")}}],"usedLegacyFallback":false}"""
        )
        assertEquals(listOf("https://a/1.jpg", "https://a/2.jpg"), MoodboardBoardsResponse.images(response, legacy = null))
    }

    @Test
    fun `own board comes first and a picture on two boards shows once`() {
        val response = boards(
            """{"own":{"id":"mine","owner_type":"partner","is_own":true,"scene":${scene("https://p/1.jpg", "https://a/1.jpg")}},"others":[{"id":"core","owner_type":"core","scene":${scene("https://a/1.jpg", "https://a/2.jpg")}}]}"""
        )
        assertEquals(
            listOf("https://p/1.jpg", "https://a/1.jpg", "https://a/2.jpg"),
            MoodboardBoardsResponse.images(response, legacy = null),
        )
    }

    @Test
    fun `falls back to the legacy blob when the boards call failed or is empty`() {
        val legacy = json.decodeFromString(MoodboardScene.serializer(), scene("https://legacy/1.jpg"))
        assertEquals(listOf("https://legacy/1.jpg"), MoodboardBoardsResponse.images(null, legacy))
        assertEquals(listOf("https://legacy/1.jpg"), MoodboardBoardsResponse.images(boards("""{"own":null,"others":[]}"""), legacy))
    }

    @Test
    fun `nothing anywhere means no moodboard section`() {
        assertTrue(MoodboardBoardsResponse.images(boards("""{"own":null,"others":[]}"""), legacy = null).isEmpty())
    }
}
