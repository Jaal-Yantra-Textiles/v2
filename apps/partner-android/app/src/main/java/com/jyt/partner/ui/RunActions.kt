package com.jyt.partner.ui

import kotlin.math.max

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.DesignInventoryItem
import com.jyt.partner.models.ProductionRun
import com.jyt.partner.models.RunTask

// The partner's next action on a run, ported from the web
// (apps/partner-ui/src/lib/run-phase.ts::getRunNextAction). Status keys
// the button, not the phase — an action that looks available and then
// fails is worse than one never offered.

enum class RunAction(val label: String) {
    ACCEPT("Accept this run"),
    START("Start production"),
    FINISH("Mark finished"),
    COMPLETE("Complete the run");

    fun hint(isSample: Boolean): String = when (this) {
        ACCEPT -> "Review the details and confirm you'll handle this work."
        START -> "Mark it started when you begin, so timelines stay accurate."
        FINISH -> if (isSample)
            "Log the materials you used as you go — this sets the design's cost estimate. Mark finished when done."
        else
            "Once finished, our team reviews the work before final completion."
        COMPLETE -> if (isSample)
            "Log final material usage and your cost estimate. This drives pricing — be thorough."
        else
            "Log any remaining material usage and your production cost to finalise."
    }
}

/** Mirrors getRunNextAction: which single action the partner owes, if any. */
fun nextRunAction(run: ProductionRun): RunAction? {
    val status = run.status ?: ""
    if (status == "cancelled" || status == "completed") return null
    if (status == "sent_to_partner") return RunAction.ACCEPT
    if (status == "in_progress") {
        if (run.startedAt == null) return RunAction.START
        if (run.finishedAt == null) return RunAction.FINISH
        return RunAction.COMPLETE
    }
    return null
}

/** The rejection-reason vocabulary, verbatim from the web form. */
enum class RejectionReason(val raw: String, val label: String) {
    STITCHING_DEFECT("stitching_defect", "Stitching defect"),
    FABRIC_FLAW("fabric_flaw", "Fabric flaw"),
    COLOR_MISMATCH("color_mismatch", "Color mismatch"),
    SIZING_ERROR("sizing_error", "Sizing error"),
    PRINT_DEFECT("print_defect", "Print defect"),
    MATERIAL_DAMAGE("material_damage", "Material damage"),
    QUALITY_BELOW_STANDARD("quality_below_standard", "Quality below standard"),
    OTHER("other", "Other");
}

enum class CostType(val raw: String, val label: String) {
    PER_UNIT("per_unit", "Per unit"),
    TOTAL("total", "Total");
}

/** Finish sheet — the FinishRunForm essentials: pending-tasks ack + notes. */
@Composable
fun FinishRunSheet(
    pendingTasks: List<RunTask>,
    isSample: Boolean,
    onConfirm: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var notes by rememberSaveable { mutableStateOf("") }
    var acknowledged by rememberSaveable { mutableStateOf(false) }
    val hasPending = pendingTasks.isNotEmpty()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Mark as Finished") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "The design will move to Technical Review for admin to inspect.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (isSample) {
                    Text(
                        "For sample runs, material usage data is needed for cost estimation. Consider logging materials before finishing.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (hasPending) {
                    Text("${pendingTasks.size} task(s) still pending", fontWeight = FontWeight.SemiBold)
                    pendingTasks.forEach { task ->
                        Text(
                            task.title ?: "Task",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Switch(checked = acknowledged, onCheckedChange = { acknowledged = it })
                        Text(
                            "I confirm these tasks are completed or not needed",
                            fontSize = 12.sp,
                            modifier = Modifier.padding(start = 8.dp),
                        )
                    }
                }
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("Notes (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onConfirm(notes.takeIf { it.isNotBlank() })
                    onDismiss()
                },
                enabled = !hasPending || acknowledged,
            ) { Text("Confirm") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** The Complete sheet — the CompleteRunForm essentials, including the backend's
 *  shortfall gate (#1271): produced + rejected must cover the order unless
 *  the shortfall is claimed AND explained.
 *
 *  Material rows live in saveable maps keyed by item id (not a remembered
 *  object list) so a rotation — or the parent screen reloading while the
 *  sheet is open — doesn't wipe what the partner has ticked and typed. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CompleteRunSheet(
    orderedQuantity: Int,
    materials: List<DesignInventoryItem>,
    onConfirm: (PartnerApi.CompleteRunBody) -> Unit,
    onDismiss: () -> Unit,
) {
    var producedQty by rememberSaveable { mutableStateOf(max(orderedQuantity, 0).toString()) }
    var rejectedQty by rememberSaveable { mutableStateOf("") }
    var rejectionReason by rememberSaveable { mutableStateOf<RejectionReason?>(null) }
    var rejectionNotes by rememberSaveable { mutableStateOf("") }
    var costText by rememberSaveable { mutableStateOf("") }
    var costType by rememberSaveable { mutableStateOf<CostType?>(null) }
    var costMenuOpen by remember { mutableStateOf(false) }
    var reasonMenuOpen by remember { mutableStateOf(false) }
    var notes by rememberSaveable { mutableStateOf("") }
    var shortfallExplanation by rememberSaveable { mutableStateOf("") }

    // Keyed by the material id list, so the same BOM after a reload (same
    // ids, new object identities) restores the typed state.
    val materialIds = materials.map { it.id }
    var usedMap by rememberSaveable(materialIds) { mutableStateOf(materials.associate { it.id to false }) }
    var qtyMap by rememberSaveable(materialIds) { mutableStateOf(mapOf<String, String>()) }
    var costMap by rememberSaveable(materialIds) { mutableStateOf(mapOf<String, String>()) }

    fun qtyOf(id: String): Double? =
        qtyMap[id]?.trim()?.toDoubleOrNull()?.takeIf { it > 0 }

    fun costOf(id: String): Double? =
        costMap[id]?.trim()?.toDoubleOrNull()?.takeIf { it > 0 }

    val produced = producedQty.toIntOrNull() ?: 0
    val rejected = rejectedQty.toIntOrNull() ?: 0
    val cost = costText.trim().toDoubleOrNull()?.takeIf { it > 0 }

    // produced + rejected must cover the order unless explained (#1271).
    val shortfall = orderedQuantity > 0 && produced + rejected < orderedQuantity

    val consumptions: List<PartnerApi.ConsumptionEntry>? =
        materials.mapNotNull { item ->
            if (usedMap[item.id] != true) return@mapNotNull null
            val qty = qtyOf(item.id) ?: return@mapNotNull null
            PartnerApi.ConsumptionEntry(
                inventoryItemId = item.id,
                quantity = qty,
                unitCost = costOf(item.id),
                unitOfMeasure = item.unitOfMeasure,
                consumptionType = "production",
            )
        }.takeIf { it.isNotEmpty() }

    val canSubmit = produced >= 0 && rejected >= 0 &&
        (rejected <= 0 || rejectionReason != null) &&
        (cost == null || costType != null) &&
        (!shortfall || shortfallExplanation.isNotBlank())

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Complete the run") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Ordered: $orderedQuantity", fontSize = 13.sp)
                OutlinedTextField(
                    value = producedQty,
                    onValueChange = { producedQty = it.filter { c -> c.isDigit() } },
                    label = { Text("Produced") },
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = rejectedQty,
                    onValueChange = { rejectedQty = it.filter { c -> c.isDigit() } },
                    label = { Text("Rejected") },
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (rejected > 0) {
                    ExposedDropdownMenuBox(
                        expanded = reasonMenuOpen,
                        onExpandedChange = { reasonMenuOpen = it },
                    ) {
                        OutlinedTextField(
                            value = rejectionReason?.label ?: "",
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Rejection reason") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(reasonMenuOpen) },
                            modifier = Modifier.menuAnchor().fillMaxWidth(),
                        )
                        ExposedDropdownMenu(expanded = reasonMenuOpen, onDismissRequest = { reasonMenuOpen = false }) {
                            RejectionReason.entries.forEach { reason ->
                                DropdownMenuItem(
                                    text = { Text(reason.label) },
                                    onClick = {
                                        rejectionReason = reason
                                        reasonMenuOpen = false
                                    },
                                )
                            }
                        }
                    }
                    OutlinedTextField(
                        value = rejectionNotes,
                        onValueChange = { rejectionNotes = it },
                        label = { Text("Rejection notes") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (materials.isNotEmpty()) {
                    Text("Materials used", fontWeight = FontWeight.SemiBold)
                    Text(
                        "The design's bill of materials. Log what this run actually consumed — it drives the cost rollup.",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    materials.forEach { item ->
                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(
                                    checked = usedMap[item.id] == true,
                                    onCheckedChange = { checked ->
                                        usedMap = usedMap + (item.id to checked)
                                    },
                                )
                                Text(item.displayName)
                            }
                            if (usedMap[item.id] == true) {
                                OutlinedTextField(
                                    value = qtyMap[item.id] ?: "",
                                    onValueChange = { text ->
                                        qtyMap = qtyMap + (item.id to text)
                                    },
                                    label = { Text("Quantity used (${item.unitOfMeasure ?: "units"})") },
                                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                    singleLine = true,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(start = 32.dp),
                                )
                                OutlinedTextField(
                                    value = costMap[item.id] ?: "",
                                    onValueChange = { text ->
                                        costMap = costMap + (item.id to text)
                                    },
                                    label = { Text("Unit cost (optional)") },
                                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                    singleLine = true,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(start = 32.dp),
                                )
                            }
                        }
                    }
                }
                if (shortfall) {
                    Text(
                        "Produced + rejected is less than ordered. Explain the shortfall — the completion will be recorded with it.",
                        fontSize = 12.sp,
                        color = androidx.compose.ui.graphics.Color(0xFFE8850C),
                    )
                    OutlinedTextField(
                        value = shortfallExplanation,
                        onValueChange = { shortfallExplanation = it },
                        label = { Text("Why the shortfall?") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                ExposedDropdownMenuBox(
                    expanded = costMenuOpen,
                    onExpandedChange = { costMenuOpen = it },
                ) {
                    OutlinedTextField(
                        value = costText,
                        onValueChange = { costText = it },
                        label = { Text("Your cost (per unit or total)") },
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        trailingIcon = {
                            Text(
                                costType?.label ?: "type",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(end = 12.dp),
                            )
                        },
                        modifier = Modifier.menuAnchor().fillMaxWidth(),
                    )
                    ExposedDropdownMenu(expanded = costMenuOpen, onDismissRequest = { costMenuOpen = false }) {
                        CostType.entries.forEach { type ->
                            DropdownMenuItem(
                                text = { Text(type.label) },
                                onClick = {
                                    costType = type
                                    costMenuOpen = false
                                },
                            )
                        }
                    }
                }
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("Notes (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    var combinedNotes = notes.trim()
                    if (shortfall) {
                        val explanation = "Shortfall explanation: ${shortfallExplanation.trim()}"
                        combinedNotes = if (combinedNotes.isEmpty()) explanation
                        else "$combinedNotes\n$explanation"
                    }
                    onConfirm(
                        PartnerApi.CompleteRunBody(
                            producedQuantity = produced,
                            rejectedQuantity = if (rejected > 0) rejected else null,
                            rejectionReason = rejectionReason?.raw,
                            rejectionNotes = rejectionNotes.takeIf { it.isNotBlank() },
                            partnerCostEstimate = cost,
                            costType = costType?.raw,
                            allowShortfall = if (shortfall) true else null,
                            notes = combinedNotes.takeIf { it.isNotBlank() },
                            consumptions = consumptions,
                        )
                    )
                    onDismiss()
                },
                enabled = canSubmit,
            ) { Text("Submit") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
