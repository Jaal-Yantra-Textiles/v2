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
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import com.jyt.partner.models.CompleteInventoryOrderBody
import com.jyt.partner.models.InventoryOrderLine
import com.jyt.partner.models.InventoryOrderStatus
import com.jyt.partner.models.PartnerInventoryOrder
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** An inventory order — the InventoryOrderDetailView counterpart. Leads
 *  with the next step (start / record the delivery), lists the goods lines
 *  with fulfilled vs outstanding, shows what charges make the order payable. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InventoryOrderDetailScreen(
    orderId: String,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var detail by remember { mutableStateOf<PartnerInventoryOrder?>(null) }
    var charges by remember { mutableStateOf<com.jyt.partner.models.InventoryOrderChargesResponse?>(null) }
    var loading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf<String?>(null) }

    var actionError by remember { mutableStateOf<String?>(null) }
    var acting by remember { mutableStateOf(false) }
    var showStartConfirm by remember { mutableStateOf(false) }
    var showReceipt by remember { mutableStateOf(false) }

    suspend fun load() {
        loading = detail == null
        try {
            detail = PartnerApi.get(context).inventoryOrder(orderId)
            errorText = null
            charges = runCatching {
                PartnerApi.get(context).inventoryOrderCharges(orderId)
            }.getOrNull()
        } catch (e: Exception) {
            errorText = e.message
        }
        loading = false
    }

    LaunchedEffect(Unit) { load() }

    val nextStep: NextStep = when (detail?.statusEnum) {
        InventoryOrderStatus.PENDING -> NextStep.START
        InventoryOrderStatus.PROCESSING, InventoryOrderStatus.PARTIAL -> NextStep.RECORD_DELIVERY
        else -> NextStep.NONE
    }

    Column(modifier = Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("Inventory order") },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
            },
        )

        val current = detail
        when {
            loading -> Box(Modifier.fillMaxSize()) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            }
            current == null -> Box(Modifier.fillMaxSize().padding(24.dp)) {
                ErrorState("Couldn't load this order", errorText ?: "") {
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
                        current.quantity?.let { StatRow("Goods ordered", formatQuantity(it)) }
                        current.outstandingQuantity.takeIf { it > 0 }?.let {
                            StatRow("Still to deliver", formatQuantity(it))
                        }
                        current.totalPrice?.let {
                            StatRow("Total", formatCurrency(it, current.currencyCode))
                        }
                        current.orderDate?.let { StatRow("Ordered", formatDate(ApiDate.parse(it))) }
                        current.expectedDeliveryDate?.let {
                            StatRow("Expected delivery", formatDate(ApiDate.parse(it)))
                        }
                        if (current.isSample == true) {
                            StatRow("Type", "Sample order")
                        }
                        StatRow("Order ID", current.id)
                    }
                }

                if (nextStep != NextStep.NONE) {
                    item {
                        SectionCard("Your next step") {
                            Text(
                                if (nextStep == NextStep.START)
                                    "Confirm you can supply this order — it moves to Processing and the team is notified."
                                else
                                    "Record what you delivered — the quantities the team receives against stock, with the delivery date and tracking number.",
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Button(
                                onClick = {
                                    if (nextStep == NextStep.START) showStartConfirm = true
                                    else showReceipt = true
                                },
                                enabled = !acting,
                                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                            ) {
                                Text(
                                    if (nextStep == NextStep.START) "Start this order" else "Record delivery",
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                    }
                }

                val lines = current.orderLines.orEmpty()
                if (lines.isNotEmpty()) {
                    item {
                        SectionCard("Goods") {
                            lines.forEach { line ->
                                Column(Modifier.padding(vertical = 4.dp)) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                    ) {
                                        Text(line.displayName, fontWeight = FontWeight.Medium)
                                        Text(
                                            formatCurrency(line.price, current.currencyCode),
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    Text(
                                        buildString {
                                            append("Ordered ${formatQuantity(line.quantity)}")
                                            if (line.fulfilled > 0) append(" · Sent ${formatQuantity(line.fulfilled)}")
                                            if (line.outstanding > 0) append(" · Outstanding ${formatQuantity(line.outstanding)}")
                                        },
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }

                val currentCharges = charges
                if (currentCharges != null && currentCharges.charges.isNotEmpty()) {
                    item {
                        SectionCard("Charges") {
                            currentCharges.charges.forEach { charge ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(charge.type.replaceFirstChar { it.uppercase() })
                                    Text(
                                        formatCurrency(charge.amount, current.currencyCode),
                                        color = if ((charge.direction ?: 0) >= 0) {
                                            androidx.compose.ui.graphics.Color.Unspecified
                                        } else {
                                            androidx.compose.ui.graphics.Color(0xFF2E7D32)
                                        },
                                    )
                                }
                            }
                            currentCharges.goodsTotal?.let {
                                StatRow("Goods total", formatCurrency(it, current.currencyCode))
                            }
                            currentCharges.payableCeiling?.let {
                                StatRow("Payable up to", formatCurrency(it, current.currencyCode))
                            }
                        }
                    }
                }

                current.partnerInfo?.let { info ->
                    if (info.partnerStatus != null || info.deliveryDate != null || !info.trackingNumber.isNullOrBlank()) {
                        item {
                            SectionCard("Delivery") {
                                info.partnerStatus?.let { StatRow("Your progress", it.replaceFirstChar { c -> c.uppercase() }) }
                                info.deliveryDate?.let { StatRow("Delivery date", formatDate(ApiDate.parse(it))) }
                                info.trackingNumber?.takeIf { it.isNotBlank() }?.let {
                                    StatRow("Tracking", it)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showStartConfirm) {
        AlertDialog(
            onDismissRequest = { showStartConfirm = false },
            title = { Text("Start this order?") },
            text = { Text("Confirm you'll supply the goods on this order?") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showStartConfirm = false
                        scope.launch {
                            acting = true
                            try {
                                PartnerApi.get(context).startInventoryOrder(orderId)
                                detail = null
                                load()
                            } catch (e: Exception) {
                                actionError = e.message
                            }
                            acting = false
                        }
                    },
                ) { Text("Start") }
            },
            dismissButton = { TextButton(onClick = { showStartConfirm = false }) { Text("Cancel") } },
        )
    }

    if (showReceipt && detail != null) {
        DeliveryReceiptSheet(order = detail!!) {
            scope.launch {
                detail = null
                load()
            }
        }
    }

    if (actionError != null) {
        AlertDialog(
            onDismissRequest = { actionError = null },
            title = { Text("Action failed") },
            text = { Text(actionError ?: "") },
            confirmButton = { TextButton(onClick = { actionError = null }) { Text("OK") } },
        )
    }
}

private enum class NextStep { START, RECORD_DELIVERY, NONE }

/** The goods receipt — per-line delivered quantities (prefilled with what's
 *  outstanding), delivery date, tracking number and notes. Quantities are
 *  editable decimals: cloth is metres and kilograms, so whole-number
 *  steppers alone can't record what actually shipped (iOS parity — its
 *  sheet pairs the steppers with a .decimalPad text field). */
@Composable
private fun DeliveryReceiptSheet(order: PartnerInventoryOrder, onDone: () -> Unit) {
    // The clamped numeric truth, plus the raw editable text per line.
    var quantities by remember(order.id) {
        mutableStateOf(
            order.orderLines.orEmpty().associate { it.id to it.outstanding }
        )
    }
    var quantityText by remember(order.id) {
        mutableStateOf(
            order.orderLines.orEmpty().associate { it.id to plainQuantity(it.outstanding) }
        )
    }

    /** Digits and a single dot, nothing else. */
    fun sanitize(raw: String): String {
        val filtered = raw.filter { it.isDigit() || it == '.' }
        val firstDot = filtered.indexOf('.')
        return if (firstDot >= 0) {
            filtered.take(firstDot + 1) + filtered.substring(firstDot + 1).replace(".", "")
        } else filtered
    }

    fun step(line: InventoryOrderLine, delta: Double) {
        val next = ((quantities[line.id] ?: 0.0) + delta).coerceIn(0.0, line.outstanding)
        quantities = quantities + (line.id to next)
        quantityText = quantityText + (line.id to plainQuantity(next))
    }

    var deliveryDateMillis by rememberSaveable { mutableStateOf(System.currentTimeMillis()) }
    var trackingNumber by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var sendError by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = { if (!sending) onDone() },
        title = { Text("Record delivery") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "These are the quantities the team receives against stock. Leave a line at 0 to deliver it later.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                order.orderLines.orEmpty().forEach { line ->
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(line.displayName, fontWeight = FontWeight.Medium)
                            Text(
                                "of ${formatQuantity(line.quantity)}",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            IconButton(
                                onClick = { step(line, -1.0) },
                            ) { Icon(Icons.Filled.Remove, contentDescription = "Less") }
                            OutlinedTextField(
                                value = quantityText[line.id] ?: "",
                                onValueChange = { raw ->
                                    val clean = sanitize(raw)
                                    quantityText = quantityText + (line.id to clean)
                                    clean.toDoubleOrNull()?.let { parsed ->
                                        quantities = quantities + (
                                            line.id to parsed.coerceIn(0.0, line.outstanding)
                                            )
                                    }
                                },
                                label = { Text("Delivered") },
                                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                                    keyboardType = KeyboardType.Decimal
                                ),
                                singleLine = true,
                                modifier = Modifier.width(110.dp),
                            )
                            IconButton(
                                onClick = { step(line, 1.0) },
                            ) { Icon(Icons.Filled.Add, contentDescription = "More") }
                            if (line.fulfilled > 0) {
                                Text(
                                    "already sent ${formatQuantity(line.fulfilled)}",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                // Delivery date — a compact prev/next-day stepper keeps the
                // dialog dependency-free.
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { deliveryDateMillis -= 86_400_000L }) {
                        Icon(Icons.Filled.Remove, contentDescription = "Earlier")
                    }
                    Text(
                        SimpleDateFormat("MMM d, yyyy", Locale.US).format(Date(deliveryDateMillis)),
                        fontWeight = FontWeight.Medium,
                    )
                    IconButton(onClick = { deliveryDateMillis += 86_400_000L }) {
                        Icon(Icons.Filled.Add, contentDescription = "Later")
                    }
                }
                OutlinedTextField(
                    value = trackingNumber,
                    onValueChange = { trackingNumber = it },
                    label = { Text("Tracking number (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("Anything the team should know (optional)") },
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
                        val lines = order.orderLines.orEmpty().mapNotNull { line ->
                            val quantity = quantities[line.id] ?: 0.0
                            // Backend validator: quantity must be > 0.
                            if (quantity <= 0.0) null
                            else CompleteInventoryOrderBody.Line(line.id, quantity)
                        }
                        if (lines.isEmpty()) {
                            sendError = "Record at least one line's delivered quantity."
                            return@TextButton
                        }
                        sending = true
                        scope.launch {
                            try {
                                PartnerApi.get(context).completeInventoryOrder(
                                    id = order.id,
                                    body = CompleteInventoryOrderBody(
                                        notes = notes.takeIf { it.isNotBlank() },
                                        deliveryDate = SimpleDateFormat("yyyy-MM-dd", Locale.US)
                                            .format(Date(deliveryDateMillis)),
                                        trackingNumber = trackingNumber.takeIf { it.isNotBlank() },
                                        lines = lines,
                                    ),
                                )
                                onDone()
                            } catch (e: Exception) {
                                sendError = e.message ?: "Couldn't record the delivery."
                            }
                            sending = false
                        }
                    },
                ) { Text("Submit") }
            }
        },
        dismissButton = {
            OutlinedButton(onClick = { if (!sending) onDone() }) { Text("Cancel") }
        },
    )
}
