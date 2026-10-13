package com.jyt.partner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.ApiDate
import com.jyt.partner.models.ProfitShare
import com.jyt.partner.models.ProfitShareSale
import com.jyt.partner.models.ProfitShareSettlement
import com.jyt.partner.models.RecordSaleBody
import com.jyt.partner.models.formatDate
import com.jyt.partner.models.profitShareReporterLabel
import com.jyt.partner.models.profitShareStatusLabel
import com.jyt.partner.models.soldAtIso
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.LocalDate

private const val SALE_DAY_MILLIS = 86_400_000L

/**
 * A run's profit share (#2401) — opened from the run screen, never its own
 * screen. What the deal is, what has sold, what we were paid, what is still
 * owed, and a form to report a sale. The caller only opens it when the run
 * has a deal (percent set). [onUpdated] receives the profit share the sale
 * POST returns, so the run screen's copy stays current too.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfitShareSheet(
    runId: String,
    profitShare: ProfitShare,
    onUpdated: (ProfitShare) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Profit share", fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
            ProfitShareSummaryBlock(profitShare)
            HorizontalDivider()
            SalesBlock(profitShare)
            HorizontalDivider()
            PaymentsBlock(profitShare)
            HorizontalDivider()
            ReportSaleForm(runId = runId, onReported = onUpdated)
        }
    }
}

private fun currencyOf(profitShare: ProfitShare): String =
    profitShare.summary?.currencyCode?.trim()?.takeIf { it.isNotEmpty() }?.uppercase() ?: "INR"

@Composable
private fun ProfitShareSummaryBlock(profitShare: ProfitShare) {
    val summary = profitShare.summary
    val currency = currencyOf(profitShare)
    val percent = (summary?.percent?.value ?: profitShare.percent?.value)

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        percent?.let { StatRow("JYT's share", "${formatQuantity(it)}%") }
        val sold = summary?.soldQuantity?.value ?: 0.0
        val runQty = summary?.runQuantity?.value
        StatRow(
            "Sold",
            if (runQty != null) "${formatQuantity(sold)} of ${formatQuantity(runQty)} pieces"
            else "${formatQuantity(sold)} pieces",
        )
        StatRow("Status", profitShareStatusLabel(summary?.status))

        if (summary?.currencyMismatch == true) {
            Text(
                "These sales and payments are in more than one currency, so the totals aren't shown. Ask JYT for the amount owed.",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.error,
            )
            return@Column
        }

        summary?.grossSales?.value?.let { StatRow("Gross sales", formatCurrency(it, currency)) }
        summary?.owed?.value?.let { owed ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Owed to JYT", fontWeight = FontWeight.SemiBold)
                Text(
                    formatCurrency(owed, currency),
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
        summary?.paid?.value?.let { StatRow("Paid", formatCurrency(it, currency)) }
        summary?.balance?.value?.let { StatRow("Balance", formatCurrency(it, currency)) }
    }
}

@Composable
private fun SalesBlock(profitShare: ProfitShare) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Sales", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        if (profitShare.sales.isEmpty()) {
            Text(
                "No sales reported yet.",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        profitShare.sales.forEach { SaleRow(it, fallbackCurrency = currencyOf(profitShare)) }
    }
}

@Composable
private fun SaleRow(sale: ProfitShareSale, fallbackCurrency: String) {
    val currency = sale.currencyCode?.uppercase() ?: fallbackCurrency
    Column(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                buildString {
                    append(sale.quantity?.value?.let { formatQuantity(it) } ?: "—")
                    append(" × ")
                    append(sale.unitPrice?.value?.let { formatCurrency(it, currency) } ?: "—")
                },
                fontWeight = FontWeight.Medium,
            )
            Text(
                sale.lineTotal?.let { formatCurrency(it, currency) } ?: "—",
                fontWeight = FontWeight.Medium,
            )
        }
        Text(
            "${formatDate(ApiDate.parse(sale.soldAt))} · Reported by ${profitShareReporterLabel(sale.reportedBy)}",
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        sale.note?.takeIf { it.isNotBlank() }?.let {
            Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun PaymentsBlock(profitShare: ProfitShare) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Payments", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        if (profitShare.settlements.isEmpty()) {
            Text(
                "No payments recorded yet.",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        profitShare.settlements.forEach { SettlementRow(it, fallbackCurrency = currencyOf(profitShare)) }
    }
}

@Composable
private fun SettlementRow(settlement: ProfitShareSettlement, fallbackCurrency: String) {
    val currency = settlement.currencyCode?.uppercase() ?: fallbackCurrency
    Column(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(formatDate(ApiDate.parse(settlement.paidAt)), fontWeight = FontWeight.Medium)
            Text(
                settlement.amount?.value?.let { formatCurrency(it, currency) } ?: "—",
                fontWeight = FontWeight.Medium,
            )
        }
        settlement.reference?.takeIf { it.isNotBlank() }?.let {
            Text("Ref: $it", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        settlement.note?.takeIf { it.isNotBlank() }?.let {
            Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReportSaleForm(runId: String, onReported: (ProfitShare) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var quantity by rememberSaveable { mutableStateOf("") }
    var unitPrice by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }
    val todayEpochDay = remember { LocalDate.now().toEpochDay() }
    var soldEpochDay by rememberSaveable { mutableStateOf(todayEpochDay) }
    var showDatePicker by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var submitError by remember { mutableStateOf<String?>(null) }
    var reported by remember { mutableStateOf(false) }

    /** Digits and a single dot. */
    fun decimal(raw: String): String {
        val filtered = raw.filter { it.isDigit() || it == '.' }
        val dot = filtered.indexOf('.')
        return if (dot >= 0) filtered.take(dot + 1) + filtered.substring(dot + 1).replace(".", "")
        else filtered
    }

    val qty = quantity.toDoubleOrNull()?.takeIf { it > 0 }
    val price = unitPrice.toDoubleOrNull()?.takeIf { it > 0 }
    val badQty = quantity.isNotBlank() && qty == null
    val badPrice = unitPrice.isNotBlank() && price == null
    val soldDate = LocalDate.ofEpochDay(soldEpochDay)

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Report a sale", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = quantity,
                onValueChange = { quantity = decimal(it); reported = false },
                label = { Text("Pieces sold") },
                isError = badQty,
                supportingText = if (badQty) {
                    { Text("More than 0") }
                } else null,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                value = unitPrice,
                onValueChange = { unitPrice = decimal(it); reported = false },
                label = { Text("Price per piece") },
                isError = badPrice,
                supportingText = if (badPrice) {
                    { Text("More than 0") }
                } else null,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
        }
        OutlinedButton(
            onClick = { showDatePicker = true },
            enabled = !submitting,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Filled.CalendarMonth, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Sold on ${formatYmd(soldDate.toString())}")
        }
        OutlinedTextField(
            value = note,
            onValueChange = { note = it.take(1000); reported = false },
            label = { Text("Note (optional)") },
            modifier = Modifier.fillMaxWidth(),
        )

        submitError?.let {
            Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
        }
        if (reported) {
            Text(
                "Sale reported.",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.primary,
            )
        }

        Button(
            enabled = !submitting && qty != null && price != null,
            onClick = {
                val q = qty ?: return@Button
                val p = price ?: return@Button
                submitting = true
                submitError = null
                scope.launch {
                    try {
                        val result = PartnerApi.get(context).reportProfitShareSale(
                            runId,
                            RecordSaleBody(
                                quantity = q,
                                unitPrice = p,
                                soldAt = soldAtIso(soldDate),
                                note = note.trim().takeIf { it.isNotEmpty() },
                            ),
                        )
                        onReported(result.profitShare)
                        quantity = ""
                        unitPrice = ""
                        note = ""
                        soldEpochDay = todayEpochDay
                        reported = true
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        submitError = e.message ?: "Couldn't report the sale."
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
                Text("Report sale", fontWeight = FontWeight.SemiBold)
            }
        }
    }

    if (showDatePicker) {
        // Today or earlier — a sale can't be in the future.
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = soldEpochDay * SALE_DAY_MILLIS,
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                    utcTimeMillis / SALE_DAY_MILLIS <= todayEpochDay

                override fun isSelectableYear(year: Int): Boolean =
                    year <= LocalDate.ofEpochDay(todayEpochDay).year
            },
        )
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { soldEpochDay = it / SALE_DAY_MILLIS }
                    showDatePicker = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { showDatePicker = false }) { Text("Cancel") } },
        ) {
            DatePicker(state = pickerState)
        }
    }
}
