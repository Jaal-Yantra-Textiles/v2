package com.jyt.partner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.CreateShipmentBody
import com.jyt.partner.models.CreatedShipment
import com.jyt.partner.models.ShippingRate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

/** The carriers the shipment route books with. */
private enum class ShipmentCarrier(val raw: String, val label: String) {
    SHIPROCKET("shiprocket", "Shiprocket"),
    DELHIVERY("delhivery", "Delhivery"),
}

private const val DAY_MILLIS = 86_400_000L

/** "Oct 5, 2026" for a "2026-10-05" date; the raw text if it isn't one. */
internal fun formatYmd(raw: String): String =
    runCatching {
        LocalDate.parse(raw.take(10)).format(DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US))
    }.getOrDefault(raw)

/** Couriers cheapest first; the recommended one preselected (else the cheapest). */
internal fun sortRates(rates: List<ShippingRate>): List<ShippingRate> = rates.sortedBy { it.amount }

internal fun preselectedCourier(rates: List<ShippingRate>): String? =
    (rates.firstOrNull { it.isRecommended == true } ?: sortRates(rates).firstOrNull())?.courierId

/**
 * Book a carrier shipment for an inventory order — the web's
 * inventory-order-create-shipment drawer: carrier, parcel weight and size,
 * an optional courier picked from live quotes, and the pickup date. On
 * success it shows the AWB and calls [onCreated] so the order reloads.
 * Errors are the server's own message, shown as is (a common one: the
 * pickup address is missing a house/road number).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateShipmentSheet(
    orderId: String,
    onDismiss: () -> Unit,
    onCreated: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var carrier by rememberSaveable { mutableStateOf(ShipmentCarrier.SHIPROCKET) }
    var weightKg by rememberSaveable { mutableStateOf("") }
    var length by rememberSaveable { mutableStateOf("") }
    var breadth by rememberSaveable { mutableStateOf("") }
    var height by rememberSaveable { mutableStateOf("") }
    val todayEpochDay = remember { LocalDate.now().toEpochDay() }
    var pickupEpochDay by rememberSaveable { mutableStateOf(todayEpochDay + 1) }
    var showDatePicker by remember { mutableStateOf(false) }

    var rates by remember { mutableStateOf<List<ShippingRate>?>(null) }
    var ratesLoading by remember { mutableStateOf(false) }
    var ratesError by remember { mutableStateOf<String?>(null) }
    var courierId by remember { mutableStateOf<String?>(null) }

    var submitting by remember { mutableStateOf(false) }
    var submitError by remember { mutableStateOf<String?>(null) }
    var created by remember { mutableStateOf<CreatedShipment?>(null) }

    /** Digits and a single dot. */
    fun decimal(raw: String): String {
        val filtered = raw.filter { it.isDigit() || it == '.' }
        val dot = filtered.indexOf('.')
        return if (dot >= 0) filtered.take(dot + 1) + filtered.substring(dot + 1).replace(".", "")
        else filtered
    }

    fun positive(text: String): Double? = text.toDoubleOrNull()?.takeIf { it > 0 }

    // A quote is for one parcel on one carrier — any change makes it stale.
    fun invalidateRates() {
        rates = null
        courierId = null
        ratesError = null
    }

    val weightGrams = positive(weightKg)?.let { (it * 1000).roundToInt() }?.takeIf { it > 0 }
    val lengthCm = positive(length)
    val breadthCm = positive(breadth)
    val heightCm = positive(height)
    val badWeight = weightKg.isNotBlank() && weightGrams == null
    val pickupDate = LocalDate.ofEpochDay(pickupEpochDay)
    val pickupYmd = pickupDate.toString() // ISO yyyy-MM-dd

    Dialog(
        onDismissRequest = { if (!submitting) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.fillMaxSize()) {
                TopAppBar(
                    title = { Text(if (created == null) "Create shipment" else "Shipment created") },
                    navigationIcon = {
                        IconButton(onClick = onDismiss, enabled = !submitting) {
                            Icon(Icons.Filled.Close, contentDescription = "Close")
                        }
                    },
                )

                val done = created
                if (done != null) {
                    ShipmentCreatedView(
                        shipment = done,
                        carrierLabel = carrier.label,
                        requestedPickup = pickupYmd,
                        onDone = onDismiss,
                    )
                    return@Column
                }

                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        "Book a carrier shipment (AWB + label) for this order from your registered pickup address. Weight and size are optional — leave them blank to use the carrier's defaults.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    Text("Carrier", fontWeight = FontWeight.SemiBold)
                    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                        ShipmentCarrier.entries.forEachIndexed { index, option ->
                            SegmentedButton(
                                selected = carrier == option,
                                onClick = {
                                    if (carrier != option) {
                                        carrier = option
                                        invalidateRates()
                                    }
                                },
                                shape = SegmentedButtonDefaults.itemShape(index, ShipmentCarrier.entries.size),
                            ) { Text(option.label) }
                        }
                    }

                    Text("Parcel", fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(
                        value = weightKg,
                        onValueChange = {
                            weightKg = decimal(it)
                            invalidateRates()
                        },
                        label = { Text("Weight (kg)") },
                        isError = badWeight,
                        supportingText = if (badWeight) {
                            { Text("Enter a weight above 0, e.g. 1.5") }
                        } else null,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(
                            Triple("Length", length) { v: String -> length = v },
                            Triple("Breadth", breadth) { v: String -> breadth = v },
                            Triple("Height", height) { v: String -> height = v },
                        ).forEach { (label, value, set) ->
                            OutlinedTextField(
                                value = value,
                                onValueChange = {
                                    set(decimal(it))
                                    invalidateRates()
                                },
                                label = { Text("$label (cm)", fontSize = 12.sp) },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Courier", fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.weight(1f))
                        if (ratesLoading) {
                            CircularProgressIndicator(Modifier.size(20.dp))
                        } else {
                            TextButton(
                                enabled = !submitting && !badWeight,
                                onClick = {
                                    ratesLoading = true
                                    ratesError = null
                                    scope.launch {
                                        try {
                                            val quote = PartnerApi.get(context).inventoryOrderShippingRates(
                                                orderId = orderId,
                                                carrier = carrier.raw,
                                                weightGrams = weightGrams,
                                                length = lengthCm,
                                                breadth = breadthCm,
                                                height = heightCm,
                                            )
                                            rates = sortRates(quote.rates)
                                            courierId = preselectedCourier(quote.rates)
                                        } catch (e: CancellationException) {
                                            throw e
                                        } catch (e: Exception) {
                                            rates = null
                                            ratesError = e.message ?: "Couldn't fetch courier rates."
                                        }
                                        ratesLoading = false
                                    }
                                },
                            ) { Text("Get rates") }
                        }
                    }
                    val quoted = rates
                    when {
                        ratesError != null -> Text(
                            ratesError ?: "",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.error,
                        )
                        quoted == null -> Text(
                            "Optional — tap Get rates to choose a courier, or leave it for ${carrier.label} to assign one.",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        quoted.isEmpty() -> Text(
                            "No couriers available for this route.",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        else -> Column {
                            quoted.forEach { rate ->
                                val id = rate.courierId
                                val selected = id != null && id == courierId
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .selectable(
                                            selected = selected,
                                            enabled = id != null,
                                            onClick = { courierId = id },
                                        )
                                        .padding(vertical = 2.dp),
                                ) {
                                    RadioButton(selected = selected, onClick = null, enabled = id != null)
                                    Spacer(Modifier.width(8.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(rate.courierName ?: "Courier", fontWeight = FontWeight.Medium)
                                        Text(
                                            buildString {
                                                rate.estimatedDays?.let { append("${formatQuantity(it)} days") }
                                                if (rate.isRecommended == true) {
                                                    if (isNotEmpty()) append(" · ")
                                                    append("Recommended")
                                                }
                                            },
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    Text(
                                        formatCurrency(rate.amount, rate.currencyCode ?: "INR"),
                                        fontWeight = FontWeight.Medium,
                                    )
                                }
                            }
                        }
                    }

                    Text("Pickup date", fontWeight = FontWeight.SemiBold)
                    OutlinedButton(
                        onClick = { showDatePicker = true },
                        enabled = !submitting,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Filled.CalendarMonth, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(formatYmd(pickupYmd))
                    }

                    submitError?.let {
                        Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
                    }

                    Button(
                        enabled = !submitting && !badWeight,
                        onClick = {
                            submitting = true
                            submitError = null
                            val dims = if (lengthCm != null || breadthCm != null || heightCm != null) {
                                CreateShipmentBody.Dimensions(lengthCm, breadthCm, heightCm)
                            } else null
                            scope.launch {
                                try {
                                    created = PartnerApi.get(context).createInventoryOrderShipment(
                                        orderId,
                                        CreateShipmentBody(
                                            carrier = carrier.raw,
                                            weightGrams = weightGrams,
                                            dimensionsCm = dims,
                                            preferredCourierId = courierId,
                                            pickupDate = pickupYmd,
                                        ),
                                    )
                                    onCreated()
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (e: Exception) {
                                    submitError = e.message ?: "Couldn't create the shipment."
                                }
                                submitting = false
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        if (submitting) {
                            CircularProgressIndicator(
                                Modifier.size(18.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text("Create shipment", fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }

    if (showDatePicker) {
        // Today or later — a carrier can't collect in the past.
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = pickupEpochDay * DAY_MILLIS,
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                    utcTimeMillis / DAY_MILLIS >= todayEpochDay

                override fun isSelectableYear(year: Int): Boolean =
                    year >= LocalDate.ofEpochDay(todayEpochDay).year
            },
        )
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { pickupEpochDay = it / DAY_MILLIS }
                    showDatePicker = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { showDatePicker = false }) { Text("Cancel") } },
        ) {
            DatePicker(state = pickerState)
        }
    }
}

/** The booking confirmation — the AWB is what the partner writes on the parcel. */
@Composable
private fun ShipmentCreatedView(
    shipment: CreatedShipment,
    carrierLabel: String,
    requestedPickup: String,
    onDone: () -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "The carrier has the shipment. Label the parcel with the AWB below.",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        StatRow("Carrier", shipment.carrier?.replaceFirstChar { it.uppercase() } ?: carrierLabel)
        val awb = shipment.awb?.takeIf { it.isNotBlank() }
        StatRow("AWB", awb ?: "—")
        shipment.trackingNumber?.takeIf { it.isNotBlank() && it != awb }?.let {
            StatRow("Tracking number", it)
        }
        val scheduled = shipment.pickup?.scheduledDate?.takeIf { it.isNotBlank() }
        if (scheduled != null) {
            StatRow("Pickup scheduled", formatYmd(scheduled))
        } else {
            StatRow("Pickup requested", formatYmd(requestedPickup))
            Text(
                "The carrier hasn't confirmed the pickup slot yet.",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        shipment.trackingUrl?.takeIf { it.startsWith("http") }?.let { url ->
            OutlinedButton(
                onClick = { runCatching { uriHandler.openUri(url) } },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Open tracking") }
        }
        Button(onClick = onDone, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Text("Done", fontWeight = FontWeight.SemiBold)
        }
    }
}
