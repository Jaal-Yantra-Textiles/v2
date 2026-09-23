package com.jyt.partner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.jyt.partner.models.InventoryOrderStatus
import com.jyt.partner.models.WorkStatus

// Shared status badges + thumbnails — the DesignComponents/StatusBadges
// counterpart, same color vocabulary: progress warm, completed green,
// refusals red, admin cancels neutral.

private fun badgeColors(base: Color): Color = base

@Composable
fun WorkStatusBadge(status: WorkStatus) {
    val tint = when (status) {
        WorkStatus.ASSIGNED -> Color(0xFF4C53A8)
        WorkStatus.ACCEPTED -> Color(0xFF2F6FED)
        WorkStatus.IN_PROGRESS, WorkStatus.PARTIAL -> Color(0xFFE8850C)
        WorkStatus.FINISHED, WorkStatus.COMPLETED -> Color(0xFF2E7D32)
        WorkStatus.DECLINED -> Color(0xFFC62828)
        WorkStatus.CANCELLED -> Color(0xFF757575)
    }
    StatusBadge(status.label, tint)
}

@Composable
fun RunStatusBadge(status: String) {
    val tint = when (status) {
        "in_progress" -> Color(0xFFE8850C)
        "finished" -> Color(0xFF00897B)
        "completed" -> Color(0xFF2E7D32)
        "cancelled", "awaiting_reassignment" -> Color(0xFF757575)
        "pending_review", "approved", "sent_to_partner" -> Color(0xFF4C53A8)
        else -> Color(0xFF2F6FED)
    }
    StatusBadge(status.replace('_', ' ').replaceFirstChar { it.uppercase() }, tint)
}

@Composable
fun InventoryOrderStatusBadge(status: InventoryOrderStatus) {
    val tint = when (status) {
        InventoryOrderStatus.PENDING -> Color(0xFF4C53A8)
        InventoryOrderStatus.PROCESSING, InventoryOrderStatus.PARTIAL -> Color(0xFFE8850C)
        InventoryOrderStatus.READY_FOR_DELIVERY -> Color(0xFF00897B)
        InventoryOrderStatus.SHIPPED -> Color(0xFF2F6FED)
        InventoryOrderStatus.DELIVERED -> Color(0xFF2E7D32)
        InventoryOrderStatus.CANCELLED -> Color(0xFF757575)
    }
    StatusBadge(status.raw, tint)
}

@Composable
private fun StatusBadge(label: String, tint: Color) {
    Text(
        text = label,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        color = tint,
        modifier = Modifier
            .background(badgeColors(tint).copy(alpha = 0.15f), RoundedCornerShape(50))
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
