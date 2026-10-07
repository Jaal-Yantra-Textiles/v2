package com.jyt.partner.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.jyt.partner.models.InventoryOrderStatus
import com.jyt.partner.models.WorkStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

// Shared status badges + thumbnails — the DesignComponents/StatusBadges
// counterpart, in black and white: see BadgeTone.

/** Black-and-white badges still have to tell states apart at a glance, so
 *  the TONE carries it instead of a hue: filled = waiting on you, outlined =
 *  under way, grey = done, faint = stopped. */
enum class BadgeTone { ACTION, ACTIVE, DONE, MUTED }

/** Plain "2.5" / "3" text for editable quantity fields — never
 *  locale-formatted, so it round-trips through toDoubleOrNull cleanly. */
internal fun plainQuantity(value: Double): String =
    if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()

@Composable
fun WorkStatusBadge(status: WorkStatus) {
    val tone = when (status) {
        WorkStatus.ASSIGNED -> BadgeTone.ACTION
        WorkStatus.ACCEPTED, WorkStatus.IN_PROGRESS, WorkStatus.PARTIAL -> BadgeTone.ACTIVE
        WorkStatus.FINISHED, WorkStatus.COMPLETED -> BadgeTone.DONE
        WorkStatus.DECLINED, WorkStatus.CANCELLED -> BadgeTone.MUTED
    }
    StatusBadge(status.label, tone)
}

@Composable
fun RunStatusBadge(status: String) {
    val tone = when (status) {
        "sent_to_partner" -> BadgeTone.ACTION
        "completed" -> BadgeTone.DONE
        "cancelled", "awaiting_reassignment" -> BadgeTone.MUTED
        else -> BadgeTone.ACTIVE
    }
    StatusBadge(status.replace('_', ' ').replaceFirstChar { it.uppercase() }, tone)
}

@Composable
fun InventoryOrderStatusBadge(status: InventoryOrderStatus) {
    val tone = when (status) {
        InventoryOrderStatus.PENDING -> BadgeTone.ACTION
        InventoryOrderStatus.PROCESSING, InventoryOrderStatus.PARTIAL,
        InventoryOrderStatus.READY_FOR_DELIVERY, InventoryOrderStatus.SHIPPED -> BadgeTone.ACTIVE
        InventoryOrderStatus.DELIVERED -> BadgeTone.DONE
        InventoryOrderStatus.CANCELLED -> BadgeTone.MUTED
    }
    StatusBadge(status.raw, tone)
}

/** Draft waits on the partner; Pending / Under review are with us. */
@Composable
fun PaymentStatusBadge(status: String) {
    val tone = when (status) {
        "Draft" -> BadgeTone.ACTION
        "Approved", "Paid", "Completed" -> BadgeTone.DONE
        "Rejected", "Failed", "Cancelled" -> BadgeTone.MUTED
        else -> BadgeTone.ACTIVE
    }
    StatusBadge(status.replace('_', ' '), tone)
}

@Composable
fun StatusBadge(label: String, tone: BadgeTone) {
    val scheme = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(50)
    val (bg, fg) = when (tone) {
        BadgeTone.ACTION -> scheme.onSurface to scheme.surface
        BadgeTone.ACTIVE -> Color.Transparent to scheme.onSurface
        BadgeTone.DONE -> scheme.surfaceVariant to scheme.onSurface
        BadgeTone.MUTED -> Color.Transparent to scheme.onSurfaceVariant
    }
    val border = when (tone) {
        BadgeTone.ACTIVE -> scheme.onSurface
        BadgeTone.MUTED -> scheme.outlineVariant
        else -> null
    }
    Text(
        text = label,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        color = fg,
        modifier = Modifier
            .background(bg, shape)
            .then(if (border != null) Modifier.border(1.dp, border, shape) else Modifier)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** The design's picture — flagged thumbnail resolved server-side, initial
 *  as the fallback (the DesignThumb counterpart). */
@Composable
fun DesignThumb(name: String?, thumbnail: String?, size: Int = 44) {
    val dpSize = size.dp
    Box(
        modifier = Modifier
            .size(dpSize)
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center,
    ) {
        val url = thumbnail?.takeIf { it.isNotBlank() }
        if (url != null) {
            AsyncImage(
                model = url,
                contentDescription = name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(dpSize),
            )
        } else {
            Text(
                text = (name ?: "D").take(1).uppercase(),
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Caption-over-value stat pair used by the list rows. */
@Composable
fun StatPair(caption: String, value: String, modifier: Modifier = Modifier, alignEnd: Boolean = false) {
    Column(
        modifier = modifier,
        horizontalAlignment = if (alignEnd) Alignment.End else Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = caption.uppercase(),
            fontSize = 10.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(text = value, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

/** A row for empty content: icon, headline, supporting copy. */
@Composable
fun EmptyState(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, subtitle: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        androidx.compose.material3.Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(text = title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        Text(
            text = subtitle,
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The "Your next step" action as a full-width bottom bar — drag the knob
 *  to the far edge to fire it. The deliberate drag IS the confirmation, so
 *  the action runs directly (no follow-up dialog); releasing early snaps
 *  the knob back. A completed slide buzzes and resets. */
@Composable
fun SlideToConfirmBar(
    text: String,
    enabled: Boolean,
    onSlideComplete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    val knobSize = 48.dp
    val trackInset = 6.dp
    var trackWidthPx by remember { mutableStateOf(0) }
    val knobPx = with(density) { knobSize.toPx() }
    val insetPx = with(density) { trackInset.toPx() }
    val maxDrag = (trackWidthPx - knobPx - 2 * insetPx).coerceAtLeast(0f)

    val dragX = remember { Animatable(0f) }
    var completing by remember { mutableStateOf(false) }
    val progress = if (maxDrag > 0f) dragX.value / maxDrag else 0f

    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp)
            .height(60.dp)
            .clip(RoundedCornerShape(30.dp))
            .background(
                if (enabled) {
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.16f + 0.5f * progress)
                } else {
                    MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
                }
            )
            .onGloballyPositioned { trackWidthPx = it.size.width }
            .pointerInput(enabled, maxDrag) {
                detectHorizontalDragGestures(
                    onHorizontalDrag = { change, amount ->
                        if (enabled && !completing) {
                            change.consume()
                            scope.launch {
                                dragX.snapTo((dragX.value + amount).coerceIn(0f, maxDrag))
                            }
                        }
                    },
                    onDragEnd = {
                        if (enabled && !completing && maxDrag > 0f && dragX.value >= maxDrag * 0.92f) {
                            completing = true
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            onSlideComplete()
                            scope.launch {
                                dragX.animateTo(maxDrag)
                                delay(280)
                                dragX.snapTo(0f)
                                completing = false
                            }
                        } else if (dragX.value > 0f) {
                            scope.launch { dragX.animateTo(0f) }
                        }
                    },
                )
            },
    ) {
        Text(
            text = text,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .align(Alignment.Center)
                .padding(horizontal = 24.dp),
        )
        Box(
            modifier = Modifier
                .align(Alignment.CenterStart)
                .padding(start = trackInset)
                .offset { IntOffset(dragX.value.roundToInt(), 0) }
                .size(knobSize)
                .clip(CircleShape)
                .background(
                    if (enabled) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.outline
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = null,
                tint = if (enabled) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.surface,
            )
        }
    }
}
