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
 *  with the next steps (start / record the delivery / mark ready / book a
 *  carrier shipment), lists the goods lines with fulfilled vs outstanding,
 *  the carrier shipments, and what charges make the order payable. */
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
    var showReadyConfirm by remember { mutableStateOf(false) }
    var showReceipt by remember { mutableStateOf(false) }
    var showShipment by remember { mutableStateOf(false) }

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

    val steps: List<OrderStep> = orderSteps(detail?.statusEnum)

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

                if (steps.isNotEmpty()) {
                    item {
                        SectionCard("Your next step") {
                            Text(
                                nextStepHint(current.statusEnum),
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            steps.forEachIndexed { index, step ->
                                val onClick = {
                                    when (step) {
                                        OrderStep.START -> showStartConfirm = true
                                        OrderStep.RECORD_DELIVERY -> showReceipt = true
                                        OrderStep.READY_FOR_DELIVERY -> showReadyConfirm = true
                                        OrderStep.CREATE_SHIPMENT -> showShipment = true
                                    }
                                }
                                val modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = if (index == 0) 6.dp else 0.dp)
                                // The first step leads; the rest are alternatives.
                                if (index == 0) {
                                    Button(onClick = onClick, enabled = !acting, modifier = modifier) {
                                        Text(step.label, fontWeight = FontWeight.SemiBold)
                                    }
                                } else {
                                    OutlinedButton(onClick = onClick, enabled = !acting, modifier = modifier) {
                                        Text(step.label)
                                    }
                                }
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

                val shipments = current.shipments.orEmpty()
                if (shipments.isNotEmpty()) {
                    item {
                        SectionCard("Shipments") {
                            shipments.forEachIndexed { index, shipment ->
                                if (index > 0) {
                                    androidx.compose.material3.HorizontalDivider(Modifier.padding(vertical = 4.dp))
                                }
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(
                                        shipment.carrier?.replaceFirstChar { it.uppercase() } ?: "Carrier",
                                        fontWeight = FontWeight.Medium,
                                    )
                                    shipment.status?.let {
                                        Text(
                                            shipmentStatusLabel(it),
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                (shipment.awb ?: shipment.trackingNumber)?.takeIf { it.isNotBlank() }?.let {
                                    StatRow("AWB", it)
                                }
                                shipment.pickupScheduledDate?.takeIf { it.isNotBlank() }?.let {
                                    StatRow("Pickup", formatYmd(it))
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

    if (showReadyConfirm) {
        AlertDialog(
            onDismissRequest = { showReadyConfirm = false },
            title = { Text("Ready for delivery?") },
            text = { Text("Confirm the goods are packed and ready to hand to the carrier.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showReadyConfirm = false
                        scope.launch {
                            acting = true
                            try {
                                PartnerApi.get(context).markInventoryOrderReadyForDelivery(orderId)
                                detail = null
                                load()
                            } catch (e: Exception) {
                                actionError = e.message
                            }
                            acting = false
                        }
                    },
                ) { Text("Mark ready") }
            },
            dismissButton = { TextButton(onClick = { showReadyConfirm = false }) { Text("Cancel") } },
        )
    }

    // Closing the sheet — submitted or cancelled — always clears the flag;
    // it used to stay true, so the dialog came straight back.
    if (showReceipt && detail != null) {
        DeliveryReceiptSheet(
            order = detail!!,
            onDismiss = { showReceipt = false },
            onRecorded = {
                showReceipt = false
                scope.launch {
                    detail = null
                    load()
                }
            },
        )
    }

    if (showShipment) {
        CreateShipmentSheet(
            orderId = orderId,
            onDismiss = { showShipment = false },
            // Reload behind the sheet so the new shipment is listed by the
            // time the partner closes the confirmation.
            onCreated = { scope.launch { load() } },
        )
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

internal enum class OrderStep(val label: String) {
    START("Start this order"),
    RECORD_DELIVERY("Record delivery"),
    READY_FOR_DELIVERY("Mark ready for delivery"),
    CREATE_SHIPMENT("Create shipment"),
}

/** What the partner can do next, by status — the backend's own gates:
 *  ready-for-delivery only from Partial; a carrier shipment from
 *  Processing, Partial, Ready for Delivery or Shipped (shipment-guard). */
internal fun orderSteps(status: InventoryOrderStatus?): List<OrderStep> = when (status) {
    InventoryOrderStatus.PENDING -> listOf(OrderStep.START)
    InventoryOrderStatus.PROCESSING -> listOf(OrderStep.RECORD_DELIVERY, OrderStep.CREATE_SHIPMENT)
    InventoryOrderStatus.PARTIAL -> listOf(
        OrderStep.RECORD_DELIVERY,
        OrderStep.READY_FOR_DELIVERY,
        OrderStep.CREATE_SHIPMENT,
    )
    InventoryOrderStatus.READY_FOR_DELIVERY, InventoryOrderStatus.SHIPPED ->
        listOf(OrderStep.CREATE_SHIPMENT)
    else -> emptyList()
}

private fun nextStepHint(status: InventoryOrderStatus?): String = when (status) {
    InventoryOrderStatus.PENDING ->
        "Confirm you can supply this order — it moves to Processing and the team is notified."
    InventoryOrderStatus.PROCESSING ->
        "Record what you delivered — the quantities the team receives against stock — or book a carrier shipment to send the goods."
    InventoryOrderStatus.PARTIAL ->
        "Part of this order is recorded as delivered. Record the rest, mark it ready once the goods are packed, or book a carrier shipment."
    InventoryOrderStatus.READY_FOR_DELIVERY ->
        "The goods are packed. Book a carrier shipment to send them."
    InventoryOrderStatus.SHIPPED ->
        "This order has shipped. Book another carrier shipment if more goods still have to go."
    else -> ""
}

private fun shipmentStatusLabel(raw: String): String = when (raw) {
    "created" -> "Created"
    "pickup_scheduled" -> "Pickup scheduled"
    "picked_up" -> "Picked up"
    "in_transit" -> "In transit"
    "out_for_delivery" -> "Out for delivery"
    "delivered" -> "Delivered"
    "rto" -> "Returning to sender"
    "cancelled" -> "Cancelled"
    else -> raw.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

/** The goods receipt — per-line delivered quantities (prefilled with what's
 *  outstanding), delivery date, tracking number and notes. Quantities are
 *  editable decimals: cloth is metres and kilograms, so whole-number
 *  steppers alone can't record what actually shipped (iOS parity — its
 *  sheet pairs the steppers with a .decimalPad text field). */
@Composable
private fun DeliveryReceiptSheet(
    order: PartnerInventoryOrder,
    onDismiss: () -> Unit,
    onRecorded: () -> Unit,
) {
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

    // Fewer than what's outstanding on any line is a partial delivery, and
    // (as on the web) the team needs a note saying why.
    val isPartial = order.orderLines.orEmpty().any { line ->
        (quantities[line.id] ?: 0.0) < line.outstanding
    }

    AlertDialog(
        onDismissRequest = { if (!sending) onDismiss() },
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
                    label = {
                        Text(
                            if (isPartial) "Why is this a partial delivery? (required)"
                            else "Anything the team should know (optional)"
                        )
                    },
                    isError = isPartial && notes.isBlank(),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (isPartial) {
                    Text(
                        "Partial delivery — add a note, or set every line to what's outstanding.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
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
                        if (isPartial && notes.isBlank()) {
                            sendError = "Add a note when delivering less than what's outstanding."
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
                                onRecorded()
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
            OutlinedButton(onClick = { if (!sending) onDismiss() }) { Text("Cancel") }
        },
    )
}
