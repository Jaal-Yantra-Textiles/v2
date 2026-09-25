package com.jyt.partner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.ApiDate
import com.jyt.partner.models.formatDate
import com.jyt.partner.models.IncomingDelivery
import com.jyt.partner.models.ReceiveIncomingBody
import kotlinx.coroutines.launch

/** One incoming delivery — what was ordered, what has been received, and
 *  the Confirm receipt action (#2286). Loads from the list read (there is no
 *  single-delivery route) with all=true so a fully received order still
 *  opens. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IncomingDeliveryDetailScreen(
    deliveryId: String,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var delivery by remember { mutableStateOf<IncomingDelivery?>(null) }
    var loading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var showReceive by rememberSaveable { mutableStateOf(false) }

    suspend fun load() {
        loading = delivery == null
        try {
            val response = PartnerApi.get(context).incomingDeliveries(all = true)
            delivery = response.incomingDeliveries.firstOrNull { it.id == deliveryId }
            errorText = null
        } catch (e: Exception) {
            errorText = e.message
        }
        loading = false
    }

    LaunchedEffect(Unit) { load() }

    val current = delivery
    androidx.compose.material3.Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Incoming delivery") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        bottomBar = {
            if (current?.canConfirm == true) {
                SlideToConfirmBar(
                    text = "Slide to confirm receipt",
                    enabled = true,
                    onSlideComplete = { showReceive = true },
                )
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                loading -> Box(Modifier.fillMaxSize()) {
                    CircularProgressIndicator(Modifier.align(Alignment.Center))
                }
                current == null -> Box(Modifier.fillMaxSize().padding(24.dp)) {
                    ErrorState("Couldn't load this delivery", errorText ?: "") {
                        scope.launch { load() }
                    }
                }
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item {
                        SectionCard("Overview") {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text("Status")
                                current.statusEnum?.let { InventoryOrderStatusBadge(it) }
                            }
                            current.from?.let { StatRow("From", it) }
                            current.expectedDeliveryDate?.let {
                                StatRow("Expected delivery", formatDate(ApiDate.parse(it)))
                            }
                            current.orderDate?.let { StatRow("Ordered", formatDate(ApiDate.parse(it))) }
                            current.invoiceNumber?.let { StatRow("Invoice", it) }
                            if (current.isSample == true) StatRow("Type", "Sample order")
                            StatRow("Delivery ID", current.id)
                        }
                    }

                    if (current.outstanding > 0) {
                        item {
                            SectionCard("Still owed") {
                                Text(
                                    "${formatQuantity(current.outstanding)} of goods confirmed outstanding across ${current.lines.size} line(s).",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }

                    if (current.lines.isNotEmpty()) {
                        item {
                            SectionCard("Goods") {
                                current.lines.forEach { line ->
                                    Column(Modifier.padding(vertical = 4.dp)) {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                        ) {
                                            Text(line.name ?: "Material", fontWeight = FontWeight.Medium)
                                            Text(
                                                "${formatQuantity(line.ordered)} ${line.unit ?: ""}".trim(),
                                                fontSize = 12.sp,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                        Text(
                                            buildString {
                                                append("Received ${formatQuantity(line.received)}")
                                                if (line.outstanding > 0) {
                                                    append(" · Outstanding ${formatQuantity(line.outstanding)}")
                                                } else {
                                                    append(" · Fully received")
                                                }
                                            },
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // Why Confirm is not offered, in the partner's terms.
                    if (current.canConfirm != true) {
                        item {
                            SectionCard("") {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Icon(
                                        imageVector = when (current.cannotConfirmReason) {
                                            "fully_received" -> Icons.Filled.CheckCircle
                                            else -> Icons.Filled.LocalShipping
                                        },
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(20.dp),
                                    )
                                    Text(
                                        when (current.cannotConfirmReason) {
                                            "fully_received", null ->
                                                "Fully received — nothing further is needed."
                                            else ->
                                                "This order hasn't been dispatched yet. You can confirm once it ships."
                                        },
                                        fontSize = 13.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showReceive && current != null) {
        ReceiveIncomingSheet(delivery = current) { success ->
            showReceive = false
            if (success) {
                scope.launch {
                    delivery = null
                    load()
                }
            }
        }
    }

    if (actionError != null) {
        AlertDialog(
            onDismissRequest = { actionError = null },
            title = { Text("Couldn't record the receipt") },
            text = { Text(actionError ?: "") },
            confirmButton = { TextButton(onClick = { actionError = null }) { Text("OK") } },
        )
    }
}

/** Confirm receipt — what actually arrived, per line (prefilled with what's
 *  outstanding; 0 is allowed for a line that brought nothing). The notes
 *  field is REQUIRED when something is short — the receipt is recorded
 *  with the shortfall and the reason. A repeat confirmation is refused by
 *  the backend, surfaced here as an error. */
@Composable
private fun ReceiveIncomingSheet(delivery: IncomingDelivery, onDone: (Boolean) -> Unit) {
    var quantityText by remember(delivery.id) {
        mutableStateOf(
            delivery.lines.associate { it.id to plainQuantity(it.outstanding) }
        )
    }
    var notes by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var sendError by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    fun parsedQuantities(): Map<String, Double> =
        delivery.lines.associate { line ->
            val clean = quantityText[line.id]?.filter { it.isDigit() || it == '.' } ?: ""
            line.id to ((clean.toDoubleOrNull() ?: 0.0).coerceIn(0.0, line.outstanding))
        }

    fun step(lineId: String, outstanding: Double, delta: Double) {
        val current = parsedQuantities()[lineId] ?: 0.0
        val next = (current + delta).coerceIn(0.0, outstanding)
        quantityText = quantityText + (lineId to plainQuantity(next))
    }

    val parsed = parsedQuantities()
    val totalOutstanding = delivery.lines.sumOf { it.outstanding }
    val totalConfirmed = parsed.values.sum()
    val isShort = totalConfirmed < totalOutstanding
    val anyPositive = parsed.values.any { it > 0 }
    val canSubmit = !sending && anyPositive && (!isShort || notes.isNotBlank())

    AlertDialog(
        onDismissRequest = { if (!sending) onDone(false) },
        title = { Text("Confirm receipt") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "State what arrived — the team receives this against your stock. Leave a line at 0 if it brought nothing.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                delivery.lines.forEach { line ->
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(line.name ?: "Material", fontWeight = FontWeight.Medium)
                            Text(
                                "of ${formatQuantity(line.ordered)}",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            IconButton(onClick = { step(line.id, line.outstanding, -1.0) }) {
                                Icon(Icons.Filled.Remove, contentDescription = "Less")
                            }
                            OutlinedTextField(
                                value = quantityText[line.id] ?: "",
                                onValueChange = { raw ->
                                    quantityText = quantityText + (line.id to raw)
                                },
                                label = { Text("Received") },
                                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                                    keyboardType = KeyboardType.Decimal
                                ),
                                singleLine = true,
                                modifier = Modifier.width(110.dp),
                            )
                            IconButton(onClick = { step(line.id, line.outstanding, 1.0) }) {
                                Icon(Icons.Filled.Add, contentDescription = "More")
                            }
                        }
                    }
                }
                if (isShort) {
                    Text(
                        "Something is short — explain why. The shortfall stays outstanding on the order.",
                        fontSize = 12.sp,
                        color = androidx.compose.ui.graphics.Color(0xFFE8850C),
                    )
                }
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = {
                        Text(if (isShort) "Why the shortfall? (required)" else "Notes (optional)")
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                if (sendError != null) {
                    Text(sendError ?: "", fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            if (sending) {
                CircularProgressIndicator(Modifier.size(20.dp))
            } else {
                TextButton(
                    onClick = {
                        sending = true
                        scope.launch {
                            try {
                                PartnerApi.get(context).receiveIncomingDelivery(
                                    orderId = delivery.id,
                                    body = ReceiveIncomingBody(
                                        lines = delivery.lines.map { line ->
                                            ReceiveIncomingBody.Line(
                                                orderLineId = line.id,
                                                quantity = parsed[line.id] ?: 0.0,
                                            )
                                        },
                                        notes = notes.takeIf { it.isNotBlank() },
                                    ),
                                )
                                onDone(true)
                            } catch (e: Exception) {
                                sendError = e.message ?: "Couldn't record the receipt."
                            }
                            sending = false
                        }
                    },
                    enabled = canSubmit,
                ) { Text("Confirm") }
            }
        },
        dismissButton = {
            OutlinedButton(onClick = { if (!sending) onDone(false) }) { Text("Cancel") }
        },
    )
}
