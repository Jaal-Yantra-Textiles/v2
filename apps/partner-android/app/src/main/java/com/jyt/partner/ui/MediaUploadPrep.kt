package com.jyt.partner.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import com.jyt.partner.api.PartnerApi
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/*
 * Getting a picked photo or video ready for upload, shared by the order
 * line edits and the production-run media upload. Photos are shrunk; both
 * then go straight to storage through PartnerApi.uploadToStorage
 * (presigned URLs), never through our API and Cloudflare's 100 MB cap.
 */

/** Longest side of an uploaded photo. Plenty to judge cloth by, and a few
 *  hundred KB instead of a 5-10 MB camera original. */
private const val MAX_PHOTO_SIDE = 2000

internal suspend fun readPart(context: Context, uri: Uri): PartnerApi.MediaPart? = withContext(Dispatchers.IO) {
    readPartBlocking(context, uri)
}

private fun readPartBlocking(context: Context, uri: Uri): PartnerApi.MediaPart? {
    val resolver = context.contentResolver
    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    val mime = resolver.getType(uri) ?: "image/jpeg"
    val name = runCatching {
        resolver.query(uri, null, null, null, null)?.use { c ->
            c.moveToFirst()
            c.getString(c.getColumnIndexOrThrow(android.provider.OpenableColumns.DISPLAY_NAME))
        }
    }.getOrNull() ?: "photo-${System.currentTimeMillis()}.jpg"
    if (!mime.startsWith("image/")) {
        return PartnerApi.MediaPart(filename = name, mimeType = mime, bytes = bytes)
    }
    val shrunk = shrinkPhoto(bytes) ?: return PartnerApi.MediaPart(filename = name, mimeType = mime, bytes = bytes)
    return PartnerApi.MediaPart(
        filename = name.substringBeforeLast('.', name) + ".jpg",
        mimeType = "image/jpeg",
        bytes = shrunk,
    )
}

/** Downscale to [MAX_PHOTO_SIDE], keep the camera's rotation, re-encode as
 *  JPEG. Null when the bytes don't decode — the caller sends them as they are. */
internal fun shrinkPhoto(bytes: ByteArray): ByteArray? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) return null
    var sample = 1
    while (longest / (sample * 2) >= MAX_PHOTO_SIDE) sample *= 2
    val decoded = BitmapFactory.decodeByteArray(
        bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample },
    ) ?: return null

    val scale = MAX_PHOTO_SIDE.toFloat() / maxOf(decoded.width, decoded.height)
    val matrix = Matrix()
    if (scale < 1f) matrix.postScale(scale, scale)
    val orientation = ExifInterface(ByteArrayInputStream(bytes))
        .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
    }
    val out = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    ByteArrayOutputStream().use { stream ->
        out.compress(Bitmap.CompressFormat.JPEG, 82, stream)
        if (out !== decoded) out.recycle()
        decoded.recycle()
        stream.toByteArray()
    }
}.getOrNull()

/**
 * The upload input for [uri]: a photo is read and shrunk in memory; anything
 * else (a video) streams from disk part by part, so a long clip never has
 * to fit in the heap.
 */
internal suspend fun storageUploadInput(context: Context, uri: Uri): PartnerApi.FolderUploadInput? =
    withContext(Dispatchers.IO) { storageUploadInputBlocking(context, uri) }

private fun storageUploadInputBlocking(context: Context, uri: Uri): PartnerApi.FolderUploadInput? {
    val resolver = context.contentResolver
    val mime = resolver.getType(uri) ?: "image/jpeg"
    if (mime.startsWith("image/")) {
        val part = readPartBlocking(context, uri) ?: return null
        return PartnerApi.FolderUploadInput(part.filename, part.mimeType, part.bytes.size.toLong()) {
            ByteArrayInputStream(part.bytes)
        }
    }
    var name = "upload-${System.currentTimeMillis()}"
    var size = -1L
    resolver.query(uri, null, null, null, null)?.use { c ->
        if (c.moveToFirst()) {
            c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }
                ?.let { c.getString(it) }?.let { name = it }
            c.getColumnIndex(android.provider.OpenableColumns.SIZE).takeIf { it >= 0 }
                ?.let { if (!c.isNull(it)) size = c.getLong(it) }
        }
    }
    if (size <= 0) {
        // No size from the provider: read it once so the parts add up.
        size = resolver.openInputStream(uri)?.use { s ->
            var total = 0L
            val buf = ByteArray(64 * 1024)
            while (true) { val n = s.read(buf); if (n <= 0) break; total += n }
            total
        } ?: return null
    }
    return PartnerApi.FolderUploadInput(name, mime, size) {
        resolver.openInputStream(uri) ?: throw IllegalStateException("The file is no longer available.")
    }
}
