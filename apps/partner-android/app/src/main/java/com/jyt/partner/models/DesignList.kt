package com.jyt.partner.models

// The Designs tab (#2402) — pure helpers behind each row of
// GET /partners/designs, kept out of the composable so they can be unit-tested.

/**
 * The picture for a design row: the design's own thumbnail, else the media
 * file flagged as the thumbnail, else the first media file. Null shows the
 * initial instead.
 */
val PartnerDesignRow.displayThumbnail: String?
    get() {
        thumbnailUrl?.takeIf { it.isNotBlank() }?.let { return it }
        val files = mediaFiles.orEmpty().filter { it.url.isNotBlank() }
        return (files.firstOrNull { it.isThumbnail == true } ?: files.firstOrNull())?.url
    }

/** Where the partner's own work on the design stands, from `partner_info`. */
val PartnerDesignRow.partnerStatus: String?
    get() = partnerInfo?.partnerStatus?.takeIf { it.isNotBlank() }

/** "In_Development" / "awaiting_review" → "In development" / "Awaiting review". */
fun designStatusLabel(raw: String?): String? {
    val words = raw?.trim()?.replace('_', ' ')?.takeIf { it.isNotEmpty() } ?: return null
    return words.lowercase().replaceFirstChar { it.uppercase() }
}

/**
 * What goes to the server as `q`. The route matches it case-insensitively
 * against the design's id, name and status, over every design the partner
 * can see, before it paginates — so the screen never filters on its own.
 * Blank means "no search".
 */
fun designSearchQuery(text: String): String? = text.trim().takeIf { it.isNotEmpty() }
