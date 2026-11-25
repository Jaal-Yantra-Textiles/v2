package com.jyt.partner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.BookPickupBody
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.LocalDate

/** Pickup slots offered; Delhivery needs a time, mid-afternoon is the default. */
internal val PICKUP_TIMES = listOf("10:00", "12:00", "14:00", "16:00")
private const val DAY_MS = 86_400_000L

/**
 * Label + pickup for one carrier shipment. "Download label" fetches a fresh
 * link each tap (Delhivery's PDF expires after 24h) and opens it. "Book pickup"
 * is offered while no pickup is booked; the carrier's refusal is shown as is.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShipmentActions(
    orderId: String,
    shipmentId: String,
    hasPickup: Boolean,
    onPickupBooked: () -> Unit = {},
) {
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    val today = remember { LocalDate.now().toEpochDay() }

    var labelLoading by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var isError by remember { mutableStateOf(false) }
    var booking by remember { mutableStateOf(false) }
    var showForm by remember { mutableStateOf(false) }
    var booked by remember { mutableStateOf(hasPickup) }
    var day by remember { mutableStateOf(today + 1) }
    var time by remember { mutableStateOf("14:00") }
    var showDate by remember { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                enabled = !labelLoading,
                onClick = {
                    labelLoading = true
                    message = null
                    scope.launch {
                        try {
                            val label = PartnerApi.get(context).inventoryShipmentLabel(orderId, shipmentId)
                            val url = label.labelUrl
                            if (url != null && url.startsWith("http")) uriHandler.openUri(url)
                            else { isError = true; message = "The label isn't ready yet. Try again in a minute." }
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            isError = true
                            message = e.message ?: "Couldn't get the label."
                        }
                        labelLoading = false
                    }
                },
            ) {
                if (labelLoading) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                else Text("Download label")
            }
            if (!booked && !showForm) {
                OutlinedButton(onClick = { showForm = true }) { Text("Book pickup") }
            }
        }

        if (showForm && !booked) {
            OutlinedButton(onClick = { showDate = true }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.CalendarMonth, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(formatYmd(LocalDate.ofEpochDay(day).toString()))
            }
            Text("Pickup time", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                PICKUP_TIMES.forEachIndexed { i, slot ->
                    SegmentedButton(
                        selected = time == slot,
                        onClick = { time = slot },
                        shape = SegmentedButtonDefaults.itemShape(i, PICKUP_TIMES.size),
                    ) { Text(slot, fontSize = 12.sp) }
                }
            }
            Button(
                enabled = !booking,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    booking = true
                    message = null
                    scope.launch {
                        try {
                            val res = PartnerApi.get(context).bookInventoryShipmentPickup(
                                orderId,
                                shipmentId,
                                BookPickupBody(LocalDate.ofEpochDay(day).toString(), time),
                            )
                            if (res.scheduled) {
                                booked = true
                                isError = false
                                message = "Pickup booked for ${formatYmd(res.pickupDate ?: "")} at ${res.pickupTime ?: time}."
                                onPickupBooked()
                            } else {
                                isError = true
                                message = "Pickup not booked: ${res.reason ?: "the carrier refused it."}"
                            }
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            isError = true
                            message = e.message ?: "Couldn't book the pickup."
                        }
                        booking = false
                    }
                },
            ) {
                if (booking) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                else Text("Book pickup")
            }
        }

        message?.let {
            Text(
                it,
                fontSize = 12.sp,
                color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    if (showDate) {
        val state = rememberDatePickerState(
            initialSelectedDateMillis = day * DAY_MS,
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean = utcTimeMillis / DAY_MS >= today
            },
        )
        DatePickerDialog(
            onDismissRequest = { showDate = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { day = it / DAY_MS }
                    showDate = false
                }) { Text("OK") }
            },
        ) { DatePicker(state = state) }
    }
}
