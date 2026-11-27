package com.jyt.partner.ui

import android.content.Context
import android.net.Uri
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.PartnerInventoryOrder
import com.jyt.partner.models.ProposeOrderLinesBody
import com.jyt.partner.models.ProposedNewMaterial
import kotlinx.coroutines.launch

/** One editable row of the proposal — an existing line ([lineId] set) or a
 *  new item the partner adds. Photos are already uploaded ([photoUrls]) or
 *  freshly picked ([newPhotos], uploaded on send). */
private class EditableLine(
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
) {
    val key = java.util.UUID.randomUUID().toString()
    var quantity by mutableStateOf(quantity)
    var price by mutableStateOf(price)
    var remove by mutableStateOf(remove)
    var name by mutableStateOf(name)
    var color by mutableStateOf(color)
    var composition by mutableStateOf(composition)
    var unit by mutableStateOf(unit)
    val photoUrls = mutableStateListOf<String>().apply { addAll(photoUrls) }
    val newPhotos = mutableStateListOf<Uri>()
    val isNew: Boolean get() = lineId == null
    val label: String get() = if (isNew) name.ifBlank { "New item" } else title
}

private fun formatNumber(v: Double): String =
    if (v == Math.floor(v)) v.toLong().toString() else v.toString()

private fun parseNumber(text: String): Double? =
    text.replace(',', '.').trim().toDoubleOrNull()

/** The mobile counterpart of the partner-ui inventory-order edit form, plus
 *  #2659: add cloth the order doesn't list and attach photos. Sends the FULL
 *  desired line set; the admin approves before anything changes. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun EditOrderLinesSheet(
    order: PartnerInventoryOrder,
    onDismiss: () -> Unit,
    onSent: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val rows = remember { mutableStateListOf<EditableLine>().apply { addAll(prefill(order)) } }
    var sending by remember { mutableStateOf(false) }
    var sendError by remember { mutableStateOf<String?>(null) }
    var photoTarget by remember { mutableStateOf<String?>(null) }
    var showMediaSource by remember { mutableStateOf(false) }

    val capture = rememberMediaCapture(
        onMedia = { uri -> rows.firstOrNull { it.key == photoTarget }?.newPhotos?.add(uri) },
        onError = { sendError = it },
        onMultiple = { uris -> rows.firstOrNull { it.key == photoTarget }?.newPhotos?.addAll(uris) },
    )

    fun submit() {
        sendError = null
        for (row in rows) {
            if (row.remove) continue
            if (row.isNew && row.name.isBlank()) {
                sendError = "Every new item needs a name."; return
            }
            val qty = parseNumber(row.quantity)
            if (qty == null || qty <= 0) {
                sendError = "Quantity must be more than 0 for ${row.label}. To drop a line, switch on \"Take off the order\"."
                return
            }
            val price = parseNumber(row.price)
            if (price == null || price < 0) {
                sendError = "Enter a price (0 or more) for ${row.label}."; return
            }
        }
        scope.launch {
            sending = true
            try {
                val api = PartnerApi.get(context)
                val lines = rows.map { row ->
                    if (row.remove && row.lineId != null) {
                        ProposeOrderLinesBody.Line(id = row.lineId, remove = true)
                    } else {
                        val photos = row.photoUrls.toMutableList()
                        if (row.newPhotos.isNotEmpty()) {
                            val parts = row.newPhotos.mapNotNull { readPart(context, it) }
                            photos += api.uploadPartnerFiles(parts).map { it.url }
                        }
                        ProposeOrderLinesBody.Line(
                            id = row.lineId,
                            quantity = parseNumber(row.quantity),
                            price = parseNumber(row.price),
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
                api.proposeInventoryOrderLines(order.id, ProposeOrderLinesBody(lines))
                onSent()
            } catch (e: Exception) {
                sendError = e.message ?: "Couldn't send your changes."
            } finally {
                sending = false
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!sending) onDismiss() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier
                .navigationBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Update order", fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
            Text(
                "Enter what you actually have. The team approves your changes before they apply.",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            rows.forEach { row ->
                LineEditor(
                    row = row,
                    onAddPhoto = { photoTarget = row.key; showMediaSource = true },
                    onRemoveNew = { rows.remove(row) },
                )
            }
            OutlinedButton(
                onClick = {
                    rows.add(EditableLine(lineId = null, title = "", quantity = "", price = "", extraCost = null))
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Filled.Add, contentDescription = null)
                Text("Add an item not on the order", modifier = Modifier.padding(start = 6.dp))
            }
            sendError?.let {
                Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onDismiss, enabled = !sending) { Text("Cancel") }
                Button(onClick = { submit() }, enabled = !sending, modifier = Modifier.weight(1f)) {
                    if (sending) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else Text("Send for approval")
                }
            }
        }
    }

    if (showMediaSource) {
        MediaSourceSheet(capture = capture, onDismiss = { showMediaSource = false }, multiple = true)
    }
}

@Composable
private fun LineEditor(row: EditableLine, onAddPhoto: () -> Unit, onRemoveNew: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (row.isNew) "New item" else row.title, fontWeight = FontWeight.Medium)
            if (row.isNew) {
                OutlinedTextField(row.name, { row.name = it }, label = { Text("Name (e.g. Matty Cotton)") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(row.color, { row.color = it }, label = { Text("Colour") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(row.composition, { row.composition = it }, label = { Text("Composition (optional)") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(row.unit, { row.unit = it }, label = { Text("Unit") }, modifier = Modifier.fillMaxWidth())
            }
            if (!row.remove) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        row.quantity, { row.quantity = it },
                        label = { Text("Quantity") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        row.price, { row.price = it },
                        label = { Text("Price / unit") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.weight(1f),
                    )
                }
                if (row.photoUrls.isNotEmpty() || row.newPhotos.isNotEmpty()) {
                    Row(
                        Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        row.photoUrls.forEach { url -> Thumb(url) }
                        row.newPhotos.forEach { uri -> Thumb(uri) }
                    }
                }
                OutlinedButton(onClick = onAddPhoto) {
                    Icon(Icons.Filled.PhotoCamera, contentDescription = null)
                    Text("Add photo", modifier = Modifier.padding(start = 6.dp))
                }
            }
            if (row.isNew) {
                TextButton(onClick = onRemoveNew) {
                    Text("Remove this item", color = MaterialTheme.colorScheme.error)
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Take off the order", modifier = Modifier.weight(1f))
                    Switch(checked = row.remove, onCheckedChange = { row.remove = it })
                }
            }
        }
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

/** Start from the partner's pending proposal when there is one, so a second
 *  visit edits what they already sent instead of starting over. */
private fun prefill(order: PartnerInventoryOrder): List<EditableLine> {
    val staged = order.pendingChange?.proposedLines.orEmpty()
    val stagedById = staged.filter { it.id != null }.associateBy { it.id!! }
    val existing = order.orderLines.orEmpty().map { line ->
        val s = stagedById[line.id]
        EditableLine(
            lineId = line.id,
            title = line.displayName,
            quantity = formatNumber(s?.quantity ?: line.quantity),
            price = formatNumber(s?.price ?: line.price),
            extraCost = s?.extraCost ?: line.extraCost,
            remove = s?.remove ?: false,
            photoUrls = s?.photos.orEmpty(),
        )
    }
    val added = staged.filter { it.id == null && it.remove != true && it.newMaterial != null }.map { l ->
        EditableLine(
            lineId = null,
            title = "",
            quantity = formatNumber(l.quantity ?: 0.0),
            price = formatNumber(l.price ?: 0.0),
            extraCost = null,
            name = l.newMaterial!!.name,
            color = l.newMaterial.color.orEmpty(),
            composition = l.newMaterial.composition.orEmpty(),
            unit = l.newMaterial.unitOfMeasure ?: "Meter",
            photoUrls = l.photos.orEmpty(),
        )
    }
    return existing + added
}

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
    return PartnerApi.MediaPart(filename = name, mimeType = mime, bytes = bytes)
}
