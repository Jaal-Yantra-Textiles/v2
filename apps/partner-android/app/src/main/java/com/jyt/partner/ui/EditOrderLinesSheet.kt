package com.jyt.partner.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import com.jyt.partner.models.PartnerException
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.PartnerInventoryOrder
import com.jyt.partner.models.ProposeOrderLinesBody
import com.jyt.partner.models.ProposedNewMaterial

/**
 * #1752/#2659 — the partner's line edits on an inventory order, collected
 * per line on the order screen and sent together as ONE proposal (the full
 * desired line set; an admin approves before anything changes).
 *
 * One row per existing line ([lineId] set) plus any new items the partner
 * adds. Rows start from the partner's PENDING proposal when there is one, so
 * sending again keeps what they already proposed instead of dropping it.
 */
internal class EditableLine(
    val lineId: String?,
    val title: String,
    quantity: String,
    price: String,
    val extraCost: Double?,
    remove: Boolean = false,
    name: String = "",
    color: String = "",
    composition: String = "",
    unit: String = "Meter",
    photoUrls: List<String> = emptyList(),
    /** From the pending proposal — shown as "waiting for approval". */
    val staged: Boolean = false,
) {
    val key = java.util.UUID.randomUUID().toString()
    var quantity by mutableStateOf(quantity)
    var price by mutableStateOf(price)
    var remove by mutableStateOf(remove)
    var name by mutableStateOf(name)
    var color by mutableStateOf(color)
    var composition by mutableStateOf(composition)
    var unit by mutableStateOf(unit)
    /** Changed on this phone and not sent yet. */
    var edited by mutableStateOf(false)
    val photoUrls = mutableStateListOf<String>().apply { addAll(photoUrls) }
    val newPhotos = mutableStateListOf<Uri>()
    val isNew: Boolean get() = lineId == null
    val label: String get() = if (isNew) name.ifBlank { "New item" } else title

    fun copy(): EditableLine = EditableLine(
        lineId, title, quantity, price, extraCost, remove, name, color, composition, unit,
        photoUrls.toList(), staged,
    ).also { it.newPhotos.addAll(newPhotos); it.edited = edited }

    fun takeFrom(draft: EditableLine) {
        quantity = draft.quantity; price = draft.price; remove = draft.remove
        name = draft.name; color = draft.color; composition = draft.composition; unit = draft.unit
        photoUrls.clear(); photoUrls.addAll(draft.photoUrls)
        newPhotos.clear(); newPhotos.addAll(draft.newPhotos)
        edited = true
    }
}

internal fun formatEditNumber(v: Double): String =
    if (v == Math.floor(v)) v.toLong().toString() else v.toString()

internal fun parseEditNumber(text: String): Double? =
    text.replace(',', '.').trim().toDoubleOrNull()

/** All of an order's line edits. Recreated when the order is re-read after
 *  a change on the server; kept across a plain refresh. */
internal class OrderEdits(order: PartnerInventoryOrder) {
    private val staged = order.pendingChange?.proposedLines.orEmpty()
    val rows: Map<String, EditableLine>
    val added = mutableStateListOf<EditableLine>()
    /** A pending new item was taken out — that alone is an edit. */
    var removedStaged by mutableStateOf(false)

    init {
        val stagedById = staged.filter { it.id != null }.associateBy { it.id!! }
        rows = order.orderLines.orEmpty().associate { line ->
            val s = stagedById[line.id]
            line.id to EditableLine(
                lineId = line.id,
                title = line.displayName,
                quantity = formatEditNumber(s?.quantity ?: line.quantity),
                price = formatEditNumber(s?.price ?: line.price),
                extraCost = s?.extraCost ?: line.extraCost,
                remove = s?.remove ?: false,
                photoUrls = s?.photos.orEmpty(),
                staged = s != null,
            )
        }
        staged.filter { it.id == null && it.remove != true && it.newMaterial != null }.forEach { l ->
            added += EditableLine(
                lineId = null,
                title = "",
                quantity = formatEditNumber(l.quantity ?: 0.0),
                price = formatEditNumber(l.price ?: 0.0),
                extraCost = null,
                name = l.newMaterial!!.name,
                color = l.newMaterial.color.orEmpty(),
                composition = l.newMaterial.composition.orEmpty(),
                unit = l.newMaterial.unitOfMeasure ?: "Meter",
                photoUrls = l.photos.orEmpty(),
                staged = true,
            )
        }
    }

    val editedCount: Int
        get() = rows.values.count { it.edited } + added.count { it.edited } + if (removedStaged) 1 else 0

    val hasEdits: Boolean get() = editedCount > 0

    /** The first problem that would make the server refuse, in plain words. */
    fun problem(): String? {
        for (row in rows.values + added) {
            if (row.remove) continue
            if (row.isNew && row.name.isBlank()) return "Every new item needs a name."
            val qty = parseEditNumber(row.quantity)
            if (qty == null || qty <= 0) return "Quantity must be more than 0 for ${row.label}. To drop a line, switch on \"Take off the order\"."
            val price = parseEditNumber(row.price)
            if (price == null || price < 0) return "Enter a price (0 or more) for ${row.label}."
        }
        return null
    }

    /** Photos already uploaded from this phone, so a retry after a failed
     *  send only uploads what is still missing (#2659 follow-up). */
    private val uploaded = mutableMapOf<Uri, String>()

    /** Upload new photos ONE AT A TIME (shrunk first) straight to storage
     *  through presigned URLs — the same initiate/parts/complete flow the
     *  shared folders use — then send the FULL desired line set. Before this
     *  a row's full-size photos went through our API in ONE request, passed
     *  Cloudflare's 100 MB body cap and came back as a bare 403. */
    suspend fun send(context: Context, orderId: String) {
        val api = PartnerApi.get(context)
        val lines = (rows.values + added).map { row ->
            if (row.remove && row.lineId != null) {
                ProposeOrderLinesBody.Line(id = row.lineId, remove = true)
            } else {
                val photos = row.photoUrls.toMutableList()
                for (uri in row.newPhotos) {
                    val url = uploaded[uri] ?: run {
                        val part = readPart(context, uri) ?: return@run null
                        val file = PartnerApi.FolderUploadInput(
                            name = part.filename,
                            mimeType = part.mimeType,
                            size = part.bytes.size.toLong(),
                        ) { ByteArrayInputStream(part.bytes) }
                        try {
                            api.uploadToStorage(file).also { uploaded[uri] = it }
                        } catch (e: PartnerException.Http) {
                            throw IllegalStateException(
                                "A photo for ${row.label} could not be uploaded. Try again, or remove that photo.",
                                e,
                            )
                        }
                    }
                    if (url != null) photos += url
                }
                ProposeOrderLinesBody.Line(
                    id = row.lineId,
                    quantity = parseEditNumber(row.quantity),
                    price = parseEditNumber(row.price),
                    // Sent back as it was: the server writes null over an omitted one.
                    extraCost = row.extraCost,
                    newMaterial = if (row.isNew) ProposedNewMaterial(
                        name = row.name.trim(),
                        color = row.color.trim().ifBlank { null },
                        composition = row.composition.trim().ifBlank { null },
                        unitOfMeasure = row.unit.trim().ifBlank { null },
                    ) else null,
                    photos = photos.ifEmpty { null },
                )
            }
        }
        api.proposeInventoryOrderLines(orderId, ProposeOrderLinesBody(lines))
    }
}

/** Edit ONE line (or a new item) — saved on the phone, sent later. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LineEditSheet(
    row: EditableLine,
    onSave: (EditableLine) -> Unit,
    onRemoveNew: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    val draft = remember(row.key) { row.copy() }
    var error by remember { mutableStateOf<String?>(null) }
    var showMediaSource by remember { mutableStateOf(false) }
    val capture = rememberMediaCapture(
        onMedia = { draft.newPhotos.add(it) },
        onError = { error = it },
        onMultiple = { draft.newPhotos.addAll(it) },
    )

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier
                .navigationBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                if (draft.isNew) "Item not on the order" else draft.title,
                fontWeight = FontWeight.SemiBold,
                fontSize = 18.sp,
            )
            if (draft.isNew) {
                OutlinedTextField(draft.name, { draft.name = it }, label = { Text("Name (e.g. Matty Cotton)") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(draft.color, { draft.color = it }, label = { Text("Colour") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(draft.composition, { draft.composition = it }, label = { Text("Composition (optional)") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(draft.unit, { draft.unit = it }, label = { Text("Unit") }, modifier = Modifier.fillMaxWidth())
            }
            if (!draft.remove) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        draft.quantity, { draft.quantity = it },
                        label = { Text("Quantity") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        draft.price, { draft.price = it },
                        label = { Text("Price / unit") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.weight(1f),
                    )
                }
                if (draft.photoUrls.isNotEmpty() || draft.newPhotos.isNotEmpty()) {
                    Row(
                        Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        draft.photoUrls.forEach { Thumb(it) }
                        draft.newPhotos.forEach { Thumb(it) }
                    }
                }
                OutlinedButton(onClick = { showMediaSource = true }) {
                    Icon(Icons.Filled.PhotoCamera, contentDescription = null)
                    Text("Add photo", modifier = Modifier.padding(start = 6.dp))
                }
            }
            if (!draft.isNew) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Take off the order", modifier = Modifier.weight(1f))
                    Switch(checked = draft.remove, onCheckedChange = { draft.remove = it })
                }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (onRemoveNew != null) {
                    TextButton(onClick = onRemoveNew) {
                        Text("Remove item", color = MaterialTheme.colorScheme.error)
                    }
                }
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Button(
                    onClick = {
                        val qty = parseEditNumber(draft.quantity)
                        val price = parseEditNumber(draft.price)
                        error = when {
                            draft.isNew && draft.name.isBlank() -> "Give the item a name."
                            draft.remove -> null
                            qty == null || qty <= 0 -> "Quantity must be more than 0. To drop the line, switch on \"Take off the order\"."
                            price == null || price < 0 -> "Enter a price (0 or more)."
                            else -> null
                        }
                        if (error == null) onSave(draft)
                    },
                    modifier = Modifier.weight(1f),
                ) { Text("Save") }
            }
            Text(
                "Saved on your phone. Tap \"Send changes for approval\" to send them.",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    if (showMediaSource) {
        MediaSourceSheet(capture = capture, onDismiss = { showMediaSource = false }, multiple = true)
    }
}

@Composable
private fun Thumb(model: Any) {
    AsyncImage(
        model = model,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = Modifier.size(56.dp).clip(RoundedCornerShape(6.dp)),
    )
}

/** Longest side of an uploaded photo. Plenty to judge cloth by, and a few
 *  hundred KB instead of a 5-10 MB camera original. */
private const val MAX_PHOTO_SIDE = 2000

private fun readPart(context: Context, uri: Uri): PartnerApi.MediaPart? {
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
private fun shrinkPhoto(bytes: ByteArray): ByteArray? = runCatching {
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
